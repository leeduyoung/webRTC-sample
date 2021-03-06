import './App.scss'

import React, { useEffect, useRef, useState } from 'react'
import io from 'socket.io-client'
import Video from './components/Video'

function App() {
  const [socket, setSocket] = useState<SocketIOClient.Socket>()
  const [users, setUsers] = useState<Array<IWebRTCUser>>([])

  let localVideoRef = useRef<HTMLVideoElement>(null)

  let sendPC: RTCPeerConnection
  let receivePCs: { [socketId: string]: RTCPeerConnection }

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
    let newSocket = io.connect('http://localhost:8080')
    let localStream: MediaStream

    newSocket.on('userEnter', (data: { id: string }) => {
      console.log('[socket event called] userEnter, data: ', data)
      createReceivePC(data.id, newSocket)
    })

    newSocket.on('allUsers', (data: { users: Array<{ id: string }> }) => {
      console.log('[socket event called] allUsers, data: ', data)
      let len = data.users.length
      for (let i = 0; i < len; i++) {
        createReceivePC(data.users[i].id, newSocket)
      }
    })

    newSocket.on('userExit', (data: { id: string }) => {
      console.log('[socket event called] userExit, data: ', data)
      receivePCs[data.id].close()
      delete receivePCs[data.id]
      setUsers((users) => users.filter((user) => user.id !== data.id))
    })

    newSocket.on('getSenderAnswer', async (data: { sdp: RTCSessionDescription }) => {
      try {
        console.log('[socket event called] getSenderAnswer, data: ', data)
        console.log(data.sdp)
        await sendPC.setRemoteDescription(new RTCSessionDescription(data.sdp))
      } catch (error) {
        console.log(error)
      }
    })

    /**
     * 해당 RTCPeerConnection의 remoteDescription으로 sdp 설정
     */
     newSocket.on('getReceiverAnswer', async (data: { id: string; sdp: RTCSessionDescription }) => {
      try {
        console.log('[socket event called] getReceiverAnswer, data: ', data)
        console.log(`get socketID(${data.id})'s answer`)
        let pc: RTCPeerConnection = receivePCs[data.id]
        await pc.setRemoteDescription(data.sdp)
        console.log(`socketID(${data.id})'s set remote sdp success`)
      } catch (error) {
        console.log(error)
      }
    })    

    newSocket.on('getSenderCandidate', async (data: { candidate: RTCIceCandidateInit }) => {
      try {
        console.log('[socket event called] getSenderCandidate, data: ', data)
        if (!data.candidate) return
        sendPC.addIceCandidate(new RTCIceCandidate(data.candidate))
        console.log('candidate add success')
      } catch (error) {
        console.log(error)
      }
    })

    newSocket.on(
      'getReceiverCandidate',
      async (data: { id: string; candidate: RTCIceCandidateInit }) => {
        console.log('[socket event called] getReceiverCandidate, data: ', data)
        try {
          console.log(data)
          console.log(`get socketID(${data.id})'s candidate`)
          let pc: RTCPeerConnection = receivePCs[data.id]
          if (!data.candidate) return
          pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          console.log(`socketID(${data.id})'s candidate add success`)
        } catch (error) {
          console.log(error)
        }
      }
    )

    setSocket(newSocket)

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          width: 240,
          height: 240,
        },
      })
      .then((stream) => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream

        localStream = stream

        sendPC = createSenderPeerConnection(newSocket, localStream)
        createSenderOffer(newSocket)

        newSocket.emit('joinRoom', {
          id: newSocket.id,
          roomID: '1234',
        })
      })
      .catch((error) => {
        console.log(`getUserMedia error: ${error}`)
      })
  }, [])

  /**
   * room에 참가한 다른 user들의 MediaStream을 받을 RTCPeerConnection을 생성하고 서버에 offer를 보냄
   *
   * @param id
   * @param newSocket
   */
  const createReceivePC = (id: string, newSocket: SocketIOClient.Socket) => {
    console.log('[func called] createReceivePC')

    try {
      console.log(`socketID(${id}) user entered`)
      let pc = createReceiverPeerConnection(id, newSocket)
      createReceiverOffer(pc, newSocket, id)
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * 자신의 MediaStream을 서버에게 보낼 RTCPeerConnection의 Offer를 생성
   * RTCSessionDescription을 본인의 RTCPeerConnection의 localDescription에 지정
   * RTCSessionDescription을 소켓을 통해서 서버로 전송
   *
   * @param newSocket
   */
  const createSenderOffer = async (newSocket: SocketIOClient.Socket) => {
    console.log('[func called] createSenderOffer')
    try {
      let sdp = await sendPC.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      })
      console.log('create sender offer success')
      await sendPC.setLocalDescription(new RTCSessionDescription(sdp))

      newSocket.emit('senderOffer', {
        sdp,
        senderSocketID: newSocket.id,
        roomID: '1234',
      })
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * senderSocketID user의 MediaStream을 전송받을 RTCPeerConnection의 offer를 생성
   *
   * @param pc
   * @param newSocket
   * @param senderSocketID
   */
  const createReceiverOffer = async (
    pc: RTCPeerConnection,
    newSocket: SocketIOClient.Socket,
    senderSocketID: string
  ) => {
    console.log('[func called] createReceiverOffer')
    try {
      let sdp = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
      console.log('create receiver offer success')
      await pc.setLocalDescription(new RTCSessionDescription(sdp))

      newSocket.emit('receiverOffer', {
        sdp, // 나의 sdp
        receiverSocketID: newSocket.id, // 나의 Socket id
        senderSocketID, // 상대방의 socket id
        roomID: '1234',
      })
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * 자신의 MediaStream을 서버로 보내기 위한 RTCPeerConnection을 생성하고 localStream을 등록
   */
  const createSenderPeerConnection = (
    newSocket: SocketIOClient.Socket,
    localStream: MediaStream
  ): RTCPeerConnection => {
    console.log('[func called] createSenderPeerConnection')
    let pc = new RTCPeerConnection(pc_config)

    /**
     * offer 또는 answer signal을 생성한 후 본인의 RTCIceCandidate 정보 이벤트 발생
     *
     * @param e
     */
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('[SenderPeerConnection event called] onicecandidate')
        newSocket.emit('senderCandidate', {
          candidate: e.candidate,
          senderSocketID: newSocket.id,
        })
      }
    }

    // ICE connection 상태가 변경되었을때 호출
    pc.oniceconnectionstatechange = (e) => {
      console.log('[SenderPeerConnection event called] oniceconnectionstatechange')
      console.log(e)
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

  /**
   * SocketID user의 MediaStream을 받기 위한 RTCPeerConnection 생성
   *
   * @param socketID
   * @param newSocket
   * @returns
   */
  const createReceiverPeerConnection = (
    socketID: string,
    newSocket: SocketIOClient.Socket
  ): RTCPeerConnection => {
    console.log('[func called] createReceiverPeerConnection')

    let pc = new RTCPeerConnection(pc_config)

    // add pc to peerConnections object
    receivePCs = { ...receivePCs, [socketID]: pc }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('[ReceiverPeerConnection event called] onicecandidate')
        console.log('receiver PC onicecandidate')
        newSocket.emit('receiverCandidate', {
          candidate: e.candidate,
          receiverSocketID: newSocket.id,
          senderSocketID: socketID,
        })
      }
    }

    pc.oniceconnectionstatechange = (e) => {
      console.log('[ReceiverPeerConnection event called] oniceconnectionstatechange')
      console.log(e)
    }

    pc.ontrack = (e) => {
      console.log('[ReceiverPeerConnection event called] ontrack')
      console.log('ontrack success')
      setUsers((oldUsers) => oldUsers.filter((user) => user.id !== socketID))
      setUsers((oldUsers) => [
        ...oldUsers,
        {
          id: socketID,
          stream: e.streams[0],
        },
      ])
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
        return <Video key={index} stream={user.stream} />
      })}
    </div>
  )
}

export default App
