import { useState, useRef } from "react";
import MP4Box from "mp4box";
import "./styles.css";
import { Radio } from "antd/";

class Writer {
  constructor(size) {
    this.data = new Uint8Array(size);
    this.idx = 0;
    this.size = size;
  }

  getData() {
    if (this.idx != this.size)
      throw "Mismatch between size reserved and sized used";

    return this.data.slice(0, this.idx);
  }

  writeUint8(value) {
    this.data.set([value], this.idx);
    this.idx++;
  }

  writeUint16(value) {
    // TODO: find a more elegant solution to endianess.
    var arr = new Uint16Array(1);
    arr[0] = value;
    var buffer = new Uint8Array(arr.buffer);
    this.data.set([buffer[1], buffer[0]], this.idx);
    this.idx += 2;
  }

  writeUint8Array(value) {
    this.data.set(value, this.idx);
    this.idx += value.length;
  }
}

function getExtradata(avccBox) {
  var i;
  var size = 7;
  for (i = 0; i < avccBox.SPS.length; i++) {
    // nalu length is encoded as a uint16.
    size += 2 + avccBox.SPS[i].length;
  }
  for (i = 0; i < avccBox.PPS.length; i++) {
    // nalu length is encoded as a uint16.
    size += 2 + avccBox.PPS[i].length;
  }

  var writer = new Writer(size);

  writer.writeUint8(avccBox.configurationVersion);
  writer.writeUint8(avccBox.AVCProfileIndication);
  writer.writeUint8(avccBox.profile_compatibility);
  writer.writeUint8(avccBox.AVCLevelIndication);
  writer.writeUint8(avccBox.lengthSizeMinusOne + (63 << 2));

  writer.writeUint8(avccBox.nb_SPS_nalus + (7 << 5));
  for (i = 0; i < avccBox.SPS.length; i++) {
    writer.writeUint16(avccBox.SPS[i].length);
    writer.writeUint8Array(avccBox.SPS[i].nalu);
  }

  writer.writeUint8(avccBox.nb_PPS_nalus);
  for (i = 0; i < avccBox.PPS.length; i++) {
    writer.writeUint16(avccBox.PPS[i].length);
    writer.writeUint8Array(avccBox.PPS[i].nalu);
  }

  return writer.getData();
}

async function createMp4BoxFile(file) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = function (e) {
      const arrayBuffer = e.target.result;
      arrayBuffer.fileStart = 0;
      mp4boxFile.appendBuffer(arrayBuffer);
    };
    mp4boxFile.onReady = function (info) {
      resolve(mp4boxFile);
    };
    mp4boxFile.onError = function (info) {
      reject(info);
    };
  });
}

async function loadVideo(src) {
  const video = document.createElement("video");
  let playing = false;
  let timeupdate = false;

  video.autoplay = true;
  video.muted = true;
  video.loop = false;
  video.src = src;
  video.play();

  const checkStatus = () => playing && timeupdate;

  return new Promise((res, rej) => {
    video.addEventListener(
      "playing",
      () => {
        playing = true;
        if (checkStatus()) {
          res(video);
        }
      },
      true
    );

    video.addEventListener(
      "timeupdate",
      () => {
        timeupdate = true;
        if (checkStatus()) {
          res(video);
        }
      },
      true
    );
  });
}

export default function App() {
  const inputRef = useRef();
  const [frames, setFrames] = useState(0);
  const [consume, setConsume] = useState(0);
  const [type, setType] = useState("WebCodecs");

  const fileChange = (e) => {
    const file = e.target.files[0];
    if (type === "ontimeupdate") {
      timeupdate(file);
    } else if (type === "requestVideoFrameCallback") {
      framecallback(file);
    } else {
      webcodes(file);
    }
  };

  const timeupdate = async (file) => {
    const video = await loadVideo(URL.createObjectURL(file));
    video.pause();
    video.currentTime = 0;

    let frameCount = 0;
    let start = Date.now();
    let ended = false;

    video.play();
    video.ontimeupdate = () => {
      video.pause();
      if (ended) {
        return;
      }
      frameCount++;
      video.play();
    };
    video.onended = () => {
      console.log("ended");
      ended = true;
      setFrames(frameCount);
      setConsume(Date.now() - start);
    };
  };

  const framecallback = async (file) => {
    const video = await loadVideo(URL.createObjectURL(file));
    video.pause();
    video.currentTime = 0;

    let frameCount = 0;
    let start = Date.now();
    let ended = false;

    const cb = (now, metadata) => {
      frameCount++;
      video.requestVideoFrameCallback(cb);
      console.log(metadata.mediaTime, metadata.presentedFrames);
    };
    video.onended = () => {
      console.log("ended");
      ended = true;
      setFrames(frameCount);
      setConsume(Date.now() - start);
    };

    video.requestVideoFrameCallback(cb);
    video.play();
  };

  const webcodes = async (file) => {
    // === use video to get frame === start ===
    // const video = await loadVideo(URL.createObjectURL(file));
    // video.pause();
    // video.currentTime = 0;
    // const videoReader = new MediaStreamTrackProcessor(
    //   videoStreamTrack
    // ).readable.getReader();

    // let frameCount = 0;
    // let start = Date.now();
    // let ended = false;

    // video.play(); // 底层好像还是依赖视频播放完成
    // while (true) {
    //   const result = await videoReader.read();
    //   if (result.done) {
    //     console.log("ended");
    //     ended = true;
    //     setFrames(frameCount);
    //     setConsume(Date.now() - start);
    //     break;
    //   }
    //   const oneFrame = result.value;
    //   console.log(oneFrame.timestamp, oneFrame.duration);
    //   frameCount++;
    //   oneFrame.close();
    // }
    // === use video to get frame === end ===

    // === demcode mp4 by hand ===
    let frameCount = 0;
    let allFrame = 0;
    let start = Date.now();
    const handleFrame = (frame) => {
      frame.close();

      console.log(++frameCount);
      if (frameCount === allFrame) {
        console.log("ended");
        setFrames(frameCount);
        setConsume(Date.now() - start);
      }
    };
    const mp4boxFile = await createMp4BoxFile(file);
    await mp4boxFile.flush();
    const fileInfo = await mp4boxFile.getInfo();
    const track = fileInfo.videoTracks[0];
    allFrame = track.nb_samples;

    const init = {
      output: handleFrame,
      error: (e) => {
        console.log(`解码失败:${e.message}`);
      }
    };
    const config = {
      codec: track.codec,
      codedWidth: track.track_width,
      codedHeight: track.track_height,
      description: getExtradata(
        mp4boxFile.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC
      )
    };
    const videoDecoder = new VideoDecoder(init);
    videoDecoder.configure(config);

    // 将 file 文件编码成 chunk
    let count = 0;
    mp4boxFile.onSamples = (track_id, ref, samples) => {
      for (const sample of samples) {
        const type = sample.is_sync ? "key" : "delta";
        const chunk = new EncodedVideoChunk({
          type: type,
          timestamp: sample.cts,
          duration: sample.duration,
          data: sample.data
        });
        console.log("sample", ++count);
        videoDecoder.decode(chunk);
      }
      if (count === allFrame) {
        videoDecoder.flush();
      }
    };
    mp4boxFile.setExtractionOptions(track.id, track);
    console.log("start mp4box");
    mp4boxFile.start();
  };

  return (
    <div className="App">
      <h1>Calculate Video Frame</h1>
      <h2>Choose calculate type and upload video file</h2>
      <p>You can use the below ffmpeg command to validate</p>
      <pre>
        ffprobe -v error -count_frames -select_streams v:0 \<br />
        -show_entries stream=nb_read_frames -of
        default=nokey=1:noprint_wrappers=1 \<br />
        mov_bbb.mp4
      </pre>

      <div>
        <Radio.Group
          onChange={(e) => {
            setType(e.target.value);
          }}
          value={type}
        >
          <Radio value="ontimeupdate">ontimeupdate</Radio>
          <Radio value="requestVideoFrameCallback">
            requestVideoFrameCallback
          </Radio>
          <Radio value="WebCodecs">WebCodecs</Radio>
        </Radio.Group>
      </div>

      <div>
        <input ref={inputRef} type="file" onChange={fileChange}></input>
        <button onClick={() => (inputRef.current.value = "")}>clear</button>
      </div>

      <p>frames: {frames}</p>
      <p>consume: {consume / 1000}s</p>
    </div>
  );
}
