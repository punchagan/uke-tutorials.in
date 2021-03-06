export const filterFavorites = (videos, f) => {
  const onlyFavorite = f?.flat().filter((x) => x.startsWith("favorite")).length > 0;
  return !onlyFavorite ? videos : videos.filter((v) => v.favorite);
};

export const filterByQuery = (videos, query) => {
  const q = query.toLocaleLowerCase();

  const match = (vid) =>
    vid?.track?.toLocaleLowerCase().indexOf(q) > -1 ||
    vid?.title?.toLocaleLowerCase().indexOf(q) > -1;

  return videos.filter(match);
};

export const filterByFacets = (videos, facetFilters, chordsSearchMode) => {
  const listFilters = new Set(["chords", "artists"]);

  const filterQ = facetFilters?.reduce((obj, ff) => {
    const [key, val] = ff[0].split(":");
    return { ...obj, [key]: ff.map((f) => f.split(":")[1]) };
  }, {});

  let data = videos;
  for (let attribute in filterQ) {
    if (attribute === "favorite") {
      continue;
    }
    let query = filterQ[attribute];

    const listFilterFuncs = {
      exact: (vid) => {
        const vidChords = new Set(vid[attribute]);
        return (
          query.length == vidChords.size &&
          query.filter((item) => vidChords.has(item)).length === query.length
        );
      },
      any: (vid) => {
        const vidChords = new Set(vid[attribute]);
        return query.filter((item) => vidChords.has(item)).length > 0;
      },
      all: (vid) => {
        const vidChords = new Set(vid[attribute]);
        return query.filter((item) => vidChords.has(item)).length === query.length;
      },
      none: (vid) => {
        const vidChords = new Set(vid[attribute]);
        return query.filter((item) => vidChords.has(item)).length === 0;
      },
    };

    if (attribute === "chords") {
      data = data.filter(listFilterFuncs[chordsSearchMode]);
    } else if (listFilters.has(attribute)) {
      data = data.filter(listFilterFuncs.any);
    } else {
      const q = new Set(query);
      data = data.filter((vid) => q.has(vid[attribute]));
    }
  }

  return data;
};

const getListCounts = (data, attribute) => {
  const counts = data
    .filter((v) => v[attribute].length > 0)
    .map((v) => v[attribute])
    .reduce((acc, attrList) => {
      attrList.forEach((item) => {
        if (item == "") {
          item = "Unknown";
        }
        acc[item] = acc[item] ? acc[item] + 1 : 1;
      });
      return acc;
    }, {});
  return counts;
};

const getArtistsCounts = (data) => getListCounts(data, "artists");
const getChordsCounts = (data) => getListCounts(data, "chords");

const getCounts = (data, attribute) => {
  const counts = data.reduce((acc, video) => {
    const val = video[attribute];
    acc[val] = acc[val] ? acc[val] + 1 : 1;
    return acc;
  }, {});
  return counts;
};

const getUploaderCounts = (data) => getCounts(data, "uploader");
const getAlbumCounts = (data) => getCounts(data, "album");
const getChordCountCounts = (data) => getCounts(data, "chordCount");
const getTuningCounts = (data) => getCounts(data, "tuning");
const getLanguageCounts = (data) => getCounts(data, "language");
const getPublishedCounts = (data) => getCounts(data, "published");

export const makeResult = (videos, page, hitsPerPage, indexName) => {
  const hits = videos.slice(hitsPerPage * page, hitsPerPage * (page + 1));
  const nbHits = videos.length;
  const nbPages = Math.ceil(nbHits / hitsPerPage);
  const facets = {
    artists: getArtistsCounts(videos),
    chords: getChordsCounts(videos),
    uploader: getUploaderCounts(videos),
    chordCount: getChordCountCounts(videos),
    album: getAlbumCounts(videos.filter((v) => v.album != "")),
    tuning: getTuningCounts(videos),
    language: getLanguageCounts(videos),
    published: getPublishedCounts(videos),
  };
  const facets_stats = {
    chordCount: {
      min: Math.min.apply(Math, Object.keys(facets.chordCount)),
      max: Math.max.apply(Math, Object.keys(facets.chordCount)),
    },
  };
  return { hits, nbHits, hitsPerPage, nbPages, facets, facets_stats, index: indexName };
};

const filterNumeric = (data, numericFilters) => {
  const q = numericFilters?.map((x) => `v.${x}`).join(" && ");
  return q === undefined ? data : data.filter((v) => eval(q));
};

export const createSearchClient = (data, chordsSearchMode) => {
  const favorites = JSON.parse(process.browser && localStorage.getItem("favorites", [])) || {};
  const objects = data.map((x) => ({
    ...x,
    objectID: x.id,
    chordCount: x.chords.length,
    tuning: x.baritone ? "Baritone" : "Standard",
    favorite: Boolean(favorites[x.id]),
    published: x.publish === 1 ? "Published" : "Unpublished",
  }));
  let resultsF, resultsA;

  const client = {
    addAlgoliaAgent: () => {},
    clearCache: () => {},
    search: async ([q]) => {
      const {
        params: { query, page, hitsPerPage, facetFilters, numericFilters },
        indexName,
      } = q;
      const sortByUploadDate = (a, b) => String(b.upload_date).localeCompare(String(a.upload_date));
      const sortByTrack = (a, b) => String(a.track).localeCompare(String(b.track));
      const sortedObjects = objects.sort(
        indexName === "upload_date" ? sortByUploadDate : sortByTrack
      );
      const favVideos = filterFavorites(sortedObjects, facetFilters);
      const videos = filterByQuery(favVideos, query);
      const videosFaceted = filterByFacets(videos, facetFilters, chordsSearchMode);
      const videosNumeric = filterNumeric(videosFaceted, numericFilters);
      resultsF = makeResult(videosNumeric, page, hitsPerPage, indexName);
      resultsA = makeResult(videos, page, hitsPerPage, indexName);
      const results = [resultsF, resultsA];
      return { results };
    },
    searchForFacetValues: async ([q]) => {
      const { facetName, facetQuery } = q.params;
      const facets = resultsF.facets[facetName];
      const facetHits = Object.keys(facets)
        .filter((facet) => facet.toLocaleLowerCase().indexOf(facetQuery.toLocaleLowerCase()) > -1)
        .map((key) => ({ value: key, count: facets[key], highlighted: key }));
      return { facetHits };
    },
  };
  return client;
};
