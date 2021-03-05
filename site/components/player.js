import {useState, useRef} from 'react'
import ReactPlayer from "react-player"

export default function Player({url, start, end}) {

  const player = useRef(null);
  const [loop, setLoop] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [loopStart, setLoopStart] = useState(start)
  const [loopEnd, setLoopEnd] = useState(end)

  const durationCallback = (duration) => {
    if (loopEnd === undefined) {
      setLoopStart(0)
      setLoopEnd(duration)
    }
  }

  const playFromStart = () => {
    player.current.seekTo(loopStart, 'seconds')
    setPlaying(true)
  }

  const progressCallback = (data) => {
    if (data.playedSeconds >= loopEnd) {
      playFromStart()
    }
  }

  return (
    <div>
      <ReactPlayer
        url={url}
        light={false}
        controls={true}
        playing={playing}
        ref={player}
        progressInterval={100}
        onDuration={durationCallback}
        onProgress={progressCallback}
        onEnded={playFromStart}
        config={{
          youtube: {
            playerVars: {
              color: "white",
              modestbranding: 1,
              rel: 0,
              showinfo: 0,
            }
          }
        }}
        />
      <input type="number" step="0.01" min="0" value={start}
             onChange={(e) => setLoopStart(e.target.value)} />
        <input type="number" step="0.01" min="0" value={end}
               onChange={(e) => setLoopEnd(e.target.value)} />
    </div>
  )
}
