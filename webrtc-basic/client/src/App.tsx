import './App.scss';

import io from 'socket.io-client';
import React, { useEffect, useRef, useState } from 'react';

function App() {
  // RTCPeerConnection
  const [pc, setPc] = useState<RTCPeerConnection>();

  // Signaling Server와 통신할 socket
  const [socket, setSocket] = useState<SocketIOClient.Socket>();

  // 본인의 video, audio를 재생할 video 태그의 ref
  let localVideoRef = useRef<HTMLVideoElement>(null);

  // 상대의 video, audio를 재생할 video 태그의 ref
  let remoteVideoRef = useRef<HTMLVideoElement>(null);

  const pc_config = {
    iceServers: [
      // {
      //   urls: 'stun:[STUN_IP]:[PORT]',
      //   'credentials': '[YOUR CREDENTIALS]',
      //   'username': '[USERNAME]'
      // },
      {
        urls: 'stun:stun.l.google.com:19302',
      },
    ],
  };

  /**
   * Socket 수신 이벤트
   *
   * all_user: 자신을 제외한 같은 방의 모든 user 목록을 받아온다
   * getOffer: 상대방에게서 offer signal 데이터로 상대방의 RTCSessionDescription을 받는다
   * getAnswer: 본인 RTCPeerConnection의 RemoteDescription으로 상대방의 RTCSessionDescription을 설정한다
   * getCandidate: 본인 RTCPeerConnection의 IceCandidate로 상대방의 RTCIceCandidate를 설정한다
   */
  useEffect(() => {
    let socketObj = io.connect('http://localhost:8080');
    let peerConnectionObj = new RTCPeerConnection(pc_config);

    socketObj.on(
      'all_users',
      (allUsers: Array<{ id: string; email: string }>) => {
        let len = allUsers.length;
        if (len > 0) {
          // user에게 Offer signal을 보낸다
          createOffer();
        }
      },
    );

    socketObj.on('getOffer', (sdp: RTCSessionDescription) => {
      console.log('get offer, sdp: ', sdp);

      // 해당 user에게 answer signal을 보낸다
      createAnswer(sdp);
    });

    socketObj.on('getAnswer', (sdp: RTCSessionDescription) => {
      console.log('get answer, sdp: ', sdp);

      // 본인 RTCPeerConnection의 RemoteDescription으로 상대방의 RTCSessionDescription을 설정한다.
      peerConnectionObj.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socketObj.on('getCandidate', (candidate: RTCIceCandidateInit) => {
      peerConnectionObj
        .addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => {
          console.log('candidate add success');
        });
    });

    setSocket(socketObj);
    setPc(peerConnectionObj);

    // MediaStream 설정 및 RTCPeerConnection 이벤트
    navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        stream.getTracks().forEach((track) => {
          peerConnectionObj.addTrack(track, stream);
        });

        // offer 또는 answer signal을 생성한후부터 본인의 icecandidate 정보 이벤트가 발생
        // offer 또는 answer를 보냈던 상대방에게 본인의 icecandidate 정보를 Signaling Server를 통해 보낸다
        peerConnectionObj.onicecandidate = (e) => {
          if (e.candidate) {
            console.log('onicecandidate');
            socketObj.emit('candidate', e.candidate);
          }
        };

        // ICE connection 상태가 변경됐을때 이벤트가 발생
        peerConnectionObj.oniceconnectionstatechange = (e) => {
          console.log(e);
        };

        // 상대방의 RTCSessionDescription을 본인의 RTCPeerConnection 에서의 remoteSessionDescription으로 지정하면
        // 상대방의 데이터(video, audio track)에 대한 이벤트가 발생
        peerConnectionObj.ontrack = (ev) => {
          console.log('add remotetrack success');

          // 상대방의 데이터를 연결
          if (remoteVideoRef.current)
            remoteVideoRef.current.srcObject = ev.streams[0];
        };

        // 방에 참여
        socketObj.emit('join_room', {
          room: '1234',
          email: 'sample@naver.com',
        });
      })
      .catch((error) => {
        console.log(`getUserMedia error: ${error}`);
      });

    // 상대방에게 offer signal 전달
    const createOffer = () => {
      console.log('create offer');
      peerConnectionObj
        .createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
        .then((sdp) => {
          peerConnectionObj.setLocalDescription(new RTCSessionDescription(sdp));
          socketObj.emit('offer', sdp);
        })
        .catch((error) => {
          console.log(error);
        });
    };

    // 상대방에게 answer signal 전달
    const createAnswer = (sdp: RTCSessionDescription) => {
      peerConnectionObj
        .setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => {
          console.log('answer set remote description success');
          peerConnectionObj
            .createAnswer({
              offerToReceiveVideo: true,
              offerToReceiveAudio: true,
            })
            .then((sdp1) => {
              console.log('create answer');
              peerConnectionObj.setLocalDescription(
                new RTCSessionDescription(sdp1),
              );

              // answer signal로 나의 sdp를 보낸다
              socketObj.emit('answer', sdp1);
            })
            .catch((error) => {
              console.log(error);
            });
        });
    };
  }, []);

  return (
    <div>
      <video
        style={{
          width: 240,
          height: 240,
          margin: 5,
          backgroundColor: 'black',
        }}
        muted
        ref={localVideoRef}
        autoPlay
      ></video>
      <video
        id="remotevideo"
        style={{
          width: 240,
          height: 240,
          margin: 5,
          backgroundColor: 'black',
        }}
        ref={remoteVideoRef}
        autoPlay
      ></video>
    </div>
  );
}

export default App;
