#!/usr/bin/env python
import io
import json
import os
import re

import pandas as pd
import youtube_dl

CHANNELS = [
    'https://www.youtube.com/c/SayaliTank/videos',
    'https://www.youtube.com/c/BollyUkeBollywoodUkuleleTutorials/videos',
]

HERE = os.path.abspath(os.path.dirname(__file__))
TITLE_RE = re.compile(
    '((simple|playalong) )*ukulele(\s+playalong)* tutot*rial\s*(with playalong)*|'
    '(with)*\s*play\s*along|'
    '\w+ (day\s)*special|'
    'fro|'
    'sayali tank|bollyuke|'
    'advance|level|fingerpicking|'
    '\(hindi\)|'
    'youtube live|'
    'simple chords( & strumming)*|'
    'simple \d chords only|'
    '(simple )*only \d+(-\d)* ((simple|basic)\s)*chords\?*|'
    'intermediate|(for )*(complete )*beginners*|easy( tutorial)*|(with\s)*tabs',
    flags=re.IGNORECASE|re.MULTILINE)
CHORDS_RE = re.compile('(?:chords(?: used)*\s*:\s*)((?:\w|,|\.|#| )+)$',
                       flags=re.IGNORECASE|re.MULTILINE)
ALBUM1_RE = re.compile('\((.*)\)', flags=re.IGNORECASE|re.MULTILINE)
ALBUM2_RE = re.compile('(?:movie|film|album)\s*(?:–|:|-)+\s*((?:\w| )+)',
                       flags=re.IGNORECASE|re.MULTILINE)
ARTISTS_RE = re.compile('(?:singer\(*s*\)*|artists*)\s*(?:–|:|-)+\s*((?:[A-Za-z0-9]| |\.|&|,)+)',
                        flags=re.IGNORECASE|re.MULTILINE)
COMPOSER_RE = re.compile('(?:music(?: director)*|compose(?:r|d)|'
                         'arranged|reprised|recreated)\s*'
                         '(?: by){0,1}\s*'
                         '(?:–|:|-)+\s*'
                         '((?:\w| |\.|&|,|-)+)',
                         flags=re.IGNORECASE|re.MULTILINE)
SONG_INFO_RE = re.compile('(, )(music|lyrics|singers*|music director|movie|composer)',
                          flags=re.IGNORECASE|re.MULTILINE)


class Downloader:

    def __init__(self):
        self.ydl_opts = {
            'dump_single_json': True,
            'simulate': True,
            'quiet': True,
            'geo_bypass': True,
            'ignoreerrors': True, # Don't stop on download errors
        }
        self.json_dir = os.path.join(os.path.dirname(HERE), '.json')
        self.data_csv = os.path.join(os.path.dirname(HERE), 'data.csv')
        os.makedirs(self.json_dir, exist_ok=True)

    def download_json(self, url):
        print(f'Downloading json for {url} ...')
        with youtube_dl.YoutubeDL(self.ydl_opts) as ydl:
            with io.StringIO() as f:
                ydl._screen_file = f
                ydl.download([url])
                f.seek(0)
                data = json.load(f)

        name = f"{data['id']}.json"
        with open(os.path.join(self.json_dir, name), 'w') as f:
            json.dump(data, f, indent=2)

        n = len(data.get('entries', []))
        print(f'Wrote {n} entries to {f.name}')

    def download_all_jsons(self):
        for channel in CHANNELS:
            downloader.download_json(channel)

    def parse_json(self, path):
        with open(path) as f:
            data = json.load(f)

        videos = []
        for i, entry in enumerate(data['entries'], start=1):
            ignore = self._ignore_video(entry)
            video = {
                'publish': int(False),
                'ignore': int(ignore),
                'id': entry['id'],
                'uploader': entry['uploader'],
                'channel': entry['channel_id'],
                'upload_date': entry['upload_date'],
                'title': entry['title'],
            }
            if not ignore:
                video.update(self._extract_info(entry))
            videos.append(video)
        return pd.DataFrame(videos)

    def parse_all_jsons(self):
        files = os.listdir(self.json_dir)
        parsed = []
        for each in files:
            path = os.path.join(self.json_dir, each)
            parsed.append(self.parse_json(path))

        data = self._merge_into_existing(pd.concat(parsed))
        self._write_data(data)

    def _write_data(self, data):
        ORDER = ['title', 'track', 'album', 'artists', 'composer', 'chords', 'key', 'publish']
        columns = sorted(data.columns, key=lambda x: ORDER.index(x) if x in ORDER else 100)
        data = data[columns].sort_values(['ignore', 'publish', 'upload_date'],
                                         ascending=[False, False, True])
        data.to_csv(self.data_csv, index=False)
        print(data.tail())

    def _merge_into_existing(self, data):
        existing = pd.read_csv(self.data_csv)

        # Prefer hand processed data, if exists.  NOTE: We assume
        # ignored rows are hand processed, to simplify the code
        # here. Manually, unset ignore flag to use the newly parsed
        # data for these rows.
        hand_processed = existing.query('publish == 1 or ignore == 1')
        hand_processed_parsed = data[data['id'].isin(hand_processed['id'])]
        hand_processed = pd.concat([hand_processed, hand_processed_parsed])\
                           .groupby('id').agg('first').reset_index()

        # When not manually edited, use the newly parsed data
        new = data[~data['id'].isin(hand_processed['id'])]

        return pd.concat([hand_processed, new])

    def _extract_info(self, entry):
        title, _ = TITLE_RE.subn('|', entry['title'])
        title, _ = re.subn('\s*\|+(\s*\|)*\s*', '|', title)
        track, album, artists = (title.split('|', 3) + [''] * 3)[:3]
        if '(' in track:
            album = ALBUM1_RE.search(track).group(1).strip()
            track = ALBUM1_RE.sub('', track).strip()

        chords = CHORDS_RE.search(entry['description'])
        if chords is not None:
            chords = chords.group(1).strip()\
                                    .replace(' and ', ',')\
                                    .replace('.', ',')\
                                    .replace(', ', ',')\
                                    .replace(' ,', ',')\
                                    .strip(',').strip().title()

        # Add newlines for original song information
        entry['description'], _ = SONG_INFO_RE.subn(',\n\\2', entry['description'])

        album_match = ALBUM2_RE.search(entry['description'])
        if album_match is not None:
            album = album_match.group(1).strip()

        artists_match = ARTISTS_RE.search(entry['description'])
        if artists_match is not None:
            artists = artists_match.group(1).strip().strip(',').replace(' &', ',')

        composer_match = COMPOSER_RE.search(entry['description'])
        if composer_match is not None:
            composer = composer_match.group(1).strip().strip(',').replace(' &', ',')
        else:
            composer = ''

        info = {
            'ignore': int(not title),
            'track': track.title(),
            'artists': artists.title(),
            'album': album.title(),
            'composer': composer.title(),
            'chords': chords,
            'key': '',
        }
        return info

    def _ignore_video(self, entry):
        title = entry['title'].lower()
        select_words = {'tutorial', 'playalong'}
        drop_words = {'mashup', 'medley', 'unboxing', 'how to practise', 'what is', 'ukebox',
                      'introduction'}
        for word in drop_words:
            if word in title:
                return True
        for word in select_words:
            if word in title:
                return False
        return True


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('-d', '--download-data', action='store_true', default=False)

    options = parser.parse_args()
    downloader = Downloader()
    if options.download_data:
        downloader.download_all_jsons()
    downloader.parse_all_jsons()
