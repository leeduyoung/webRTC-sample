import './App.scss'

import React, { useState } from 'react'
import io from 'socket.io-client'
import { useRef } from 'react'
import { useEffect } from 'react'
import Video from './components/Video'

function App() {
  const [socket, setSocket] = useState<SocketIOClient.Socket>()
  const [users, setUsers] = useState<Array<IWebRTCUser>>([])

  let localVideoRef = useRef<HTMLVideoElement>(null)

  let pcs: { [socketId: string]: RTCPeerConnection }

  const pc_config = {
    iceServers: [
      // {
      //   urls: 'stun:[STUN_IP]:[PORT]',
      //   'credentials': '[YOR CREDENTIALS]',
      //   'username': '[USERNAME]'
      // },
      {
        urls: 'stun:stun.l.google.com:19302',
      },
    ],
  }

  useEffect(() => {
    // let newSocket = io.connect('http://localhost:8080')
    let newSocket = io.connect(
      // 'http://a639e5d6a73b24986bae0c9b1308a6fd-836429463.ap-northeast-2.elb.amazonaws.com:8081',
      'https://dev-webrtc-server.luxrobo.com',
    )
    let localStream: MediaStream

    /**
     * 자신을 제외한 같은 방의 모든 user 목록을 받아온다
     */
    newSocket.on('all_users', (allUsers: Array<{ id: string; email: string }>) => {
      let len = allUsers.length

      for (let i = 0; i < len; i++) {
        // user마다 createPeerConnection 함수를 호출해서 각각의 RTCPeerConnection을 생성
        createPeerConnection(allUsers[i].id, allUsers[i].email, newSocket, localStream)
        let pc: RTCPeerConnection = pcs[allUsers[i].id]
        if (pc) {
          /**
           * 해당 user를 위해 생성한 RTCPeerConnection을 통해 createOffer 함수를 호출하고
           * offer signal을 보낸다
           */
          pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          })
            .then((sdp) => {
              console.log('create offer success')
              pc.setLocalDescription(new RTCSessionDescription(sdp))
              newSocket.emit('offer', {
                sdp: sdp,
                offerSendID: newSocket.id,
                offerSendEmail: 'offerSendSample@sample.com',
                offerReceiveID: allUsers[i].id,
              })
            })
            .catch((error) => {
              console.log(error)
            })
        }
      }
    })

    newSocket.on(
      'getOffer',
      (data: { sdp: RTCSessionDescription; offerSendID: string; offerSendEmail: string }) => {
        console.log('get offer')

        /**
         * offer를 보낸 user와의 통신을 위해 createPeerConnection 함수를 호출해서 RTCPeerConnection을 생성
         */
        createPeerConnection(data.offerSendID, data.offerSendEmail, newSocket, localStream)

        let pc: RTCPeerConnection = pcs[data.offerSendID]
        if (pc) {
          // 해당 user를 위해 생성한 RTCPeerConnection의 remoteDescription을 해당 user에게서 전달 받은 sdp로 설정
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(() => {
            console.log('answer set remote description success')

            // createAnswer 함수를 호출해서 offer를 보낸 상대방에게 answer signal을 보낸다
            pc.createAnswer({
              offerToReceiveVideo: true,
              offerToReceiveAudio: true,
            })
              .then((sdp) => {
                console.log('create answer success')
                pc.setLocalDescription(new RTCSessionDescription(sdp))
                newSocket.emit('answer', {
                  sdp: sdp,
                  answerSendID: newSocket.id,
                  answerReceiveID: data.offerSendID,
                })
              })
              .catch((error) => {
                console.log(error)
              })
          })
        }
      },
    )

    newSocket.on('getAnswer', (data: { sdp: RTCSessionDescription; answerSendID: string }) => {
      console.log('get answer')

      // answer를 보낸 user를 위해 생성해 놓은 RTCPeerConnection의 remoteDescription을 answer을 보낸 user의 sdp로 설정
      let pc: RTCPeerConnection = pcs[data.answerSendID]
      if (pc) {
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      }
      //console.log(sdp);
    })

    newSocket.on(
      'getCandidate',
      (data: { candidate: RTCIceCandidateInit; candidateSendID: string }) => {
        console.log('get candidate, data: ', data)

        // candidate를 보낸 user를 위해 생성해 놓은 RTCPeerConnection에 받은 RTCIceCandidate를 추가
        let pc: RTCPeerConnection = pcs[data.candidateSendID]
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(data.candidate)).then(() => {
            console.log('candidate add success')
          })
        }
      },
    )

    /**
     * pcs Dictionary에서 해당 user의 RTCPeerConnection을 삭제
     * users에서 해당 user의 데이터를 삭제
     */
    newSocket.on('user_exit', (data: { id: string }) => {
      pcs[data.id].close()
      delete pcs[data.id]
      setUsers((oldUsers) => oldUsers.filter((user) => user.id !== data.id))
    })

    setSocket(newSocket)

    /**
     * getUserMedia() 함수를 호출해서 자신의 MediaStream을 얻고 localVideoRef에 등록
     */
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: {
          width: 240,
          height: 240,
        },
      })
      .then((stream) => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream

        localStream = stream

        /**
         * 방에 참가했다고 signaling server에 알린다
         * 이후에 all_users 이벤트가 온다
         */
        newSocket.emit('join_room', {
          room: '1234',
          email: 'sample@naver.com',
        })
      })
      .catch((error) => {
        console.log(`getUserMedia error: ${error}`)
      })
  }, [])

  /**
   * 특정 user를 위한 PeerConnection을 생성하고 localStream을 RTCPeerConnection에 등록
   * pcs 변수에 socketId, RTCPeerConnection을 key/value 형태로 저장
   *
   * @param socketID
   * @param email
   * @param newSocket
   * @param localStream
   * @returns
   */
  const createPeerConnection = (
    socketID: string,
    email: string,
    newSocket: SocketIOClient.Socket,
    localStream: MediaStream,
  ): RTCPeerConnection => {
    let pc = new RTCPeerConnection(pc_config)

    // add pc to peerConnections object
    pcs = { ...pcs, [socketID]: pc }

    /**
     * offer 또는 answer signal을 생성한 후부터 본인의 icecandidate 정보 이벤트가 발생
     * offer 또는 answer를 보냈던 상대방에게 본인의 icecandidate 정보를 signaling server를 통해 보낸다
     *
     * @param e
     */
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('onicecandidate, candidate: ', e.candidate)
        newSocket.emit('candidate', {
          candidate: e.candidate,
          candidateSendID: newSocket.id,
          candidateReceiveID: socketID,
        })
      }
    }

    // ICE connection 상태가 변경되었을때 호출
    pc.oniceconnectionstatechange = (e) => {
      console.log(e)
    }

    /**
     * 상대방의 RTCSessionDescription을 본인의 RTCPeerConnection에서의 remoteSessionDescription으로 지정하면
     * 상대방의 track 데이터에 대한 이벤트가 발생
     *
     * 상대방의 데이터 stream을 등록
     *
     * @param e
     */
    pc.ontrack = (e) => {
      console.log('ontrack success')
      setUsers((oldUsers) => oldUsers.filter((user) => user.id !== socketID))
      setUsers((oldUsers) => [
        ...oldUsers,
        {
          id: socketID,
          email: email,
          stream: e.streams[0],
        },
      ])
    }

    if (localStream) {
      console.log('localstream add')
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream)
      })
    } else {
      console.log('no local stream')
    }

    // return pc
    return pc
  }

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
      {users.map((user, index) => {
        return <Video key={index} email={user.email} stream={user.stream} />
      })}
    </div>
  )
}

export default App
