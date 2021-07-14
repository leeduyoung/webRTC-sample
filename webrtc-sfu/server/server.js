let http = require('http')
let express = require('express')
let cors = require('cors')
let socketio = require('socket.io')
let wrtc = require('wrtc')

const app = express()
const server = http.createServer(app)

app.use(cors())

let receiverPCs = {}
let senderPCs = {}
let users = {}
let socketToRoom = {}

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

const isIncluded = (array, id) => {
  console.log('[func called] isIncluded')
  let len = array.length
  for (let i = 0; i < len; i++) {
    if (array[i].id === id) return true
  }
  return false
}

const createReceiverPeerConnection = (socketID, socket, roomID) => {
  console.log('[func called] createReceiverPeerConnection')

  let pc = new wrtc.RTCPeerConnection(pc_config)

  if (receiverPCs[socketID]) receiverPCs[socketID] = pc
  else receiverPCs = { ...receiverPCs, [socketID]: pc }

  pc.onicecandidate = (e) => {
    console.log('[ReceiverPeerConnection event called] onicecandidate')
    //console.log(`socketID: ${socketID}'s receiverPeerConnection icecandidate`);
    socket.to(socketID).emit('getSenderCandidate', {
      candidate: e.candidate,
    })
  }

  pc.oniceconnectionstatechange = (e) => {
    //console.log(e);
    console.log('[ReceiverPeerConnection event called] oniceconnectionstatechange')
  }

  pc.ontrack = (e) => {
    console.log('[ReceiverPeerConnection event called] ontrack')

    if (users[roomID]) {
      if (!isIncluded(users[roomID], socketID)) {
        users[roomID].push({
          id: socketID,
          stream: e.streams[0],
        })
      } else return
    } else {
      users[roomID] = [
        {
          id: socketID,
          stream: e.streams[0],
        },
      ]
    }
    socket.broadcast.to(roomID).emit('userEnter', { id: socketID })
  }

  return pc
}

const createSenderPeerConnection = (receiverSocketID, senderSocketID, socket, roomID) => {
  console.log('[func called] createSenderPeerConnection')
  let pc = new wrtc.RTCPeerConnection(pc_config)

  if (senderPCs[senderSocketID]) {
    senderPCs[senderSocketID].filter((user) => user.id !== receiverSocketID)
    senderPCs[senderSocketID].push({ id: receiverSocketID, pc: pc })
  } else
    senderPCs = {
      ...senderPCs,
      [senderSocketID]: [{ id: receiverSocketID, pc: pc }],
    }

  pc.onicecandidate = (e) => {
    console.log('[SenderPeerConnection event called] onicecandidate')

    //console.log(`socketID: ${receiverSocketID}'s senderPeerConnection icecandidate`);
    socket.to(receiverSocketID).emit('getReceiverCandidate', {
      id: senderSocketID,
      candidate: e.candidate,
    })
  }

  pc.oniceconnectionstatechange = (e) => {
    //console.log(e);
    console.log('[SenderPeerConnection event called] oniceconnectionstatechange')
  }

  const sendUser = users[roomID].filter((user) => user.id === senderSocketID)
  sendUser[0].stream.getTracks().forEach((track) => {
    pc.addTrack(track, sendUser[0].stream)
  })

  return pc
}

const getOtherUsersInRoom = (socketID, roomID) => {
  console.log('[func called] getOtherUsersInRoom')

  let allUsers = []

  if (!users[roomID]) return allUsers

  let len = users[roomID].length
  for (let i = 0; i < len; i++) {
    if (users[roomID][i].id === socketID) continue
    allUsers.push({ id: users[roomID][i].id })
  }

  return allUsers
}

const deleteUser = (socketID, roomID) => {
  console.log('[func called] deleteUser')

  let roomUsers = users[roomID]
  if (!roomUsers) return
  roomUsers = roomUsers.filter((user) => user.id !== socketID)
  users[roomID] = roomUsers
  if (roomUsers.length === 0) {
    delete users[roomID]
  }
  delete socketToRoom[socketID]
}

const closeRecevierPC = (socketID) => {
  console.log('[func called] closeRecevierPC')

  if (!receiverPCs[socketID]) return

  receiverPCs[socketID].close()
  delete receiverPCs[socketID]
}

const closeSenderPCs = (socketID) => {
  console.log('[func called] closeSenderPCs')

  if (!senderPCs[socketID]) return

  let len = senderPCs[socketID].length
  for (let i = 0; i < len; i++) {
    senderPCs[socketID][i].pc.close()
    let _senderPCs = senderPCs[senderPCs[socketID][i].id]
    let senderPC = _senderPCs.filter((sPC) => sPC.id === socketID)
    if (senderPC[0]) {
      senderPC[0].pc.close()
      senderPCs[senderPCs[socketID][i].id] = _senderPCs.filter((sPC) => sPC.id !== socketID)
    }
  }

  delete senderPCs[socketID]
}

const io = socketio.listen(server)

io.sockets.on('connection', (socket) => {
  socket.on('joinRoom', (data) => {
    console.log('[socket event called] joinRoom, data: ', data)

    try {
      let allUsers = getOtherUsersInRoom(data.id, data.roomID)
      io.to(data.id).emit('allUsers', { users: allUsers })
    } catch (error) {
      console.log(error)
    }
  })

  socket.on('senderOffer', async (data) => {
    console.log('[socket event called] senderOffer')

    try {
      socketToRoom[data.senderSocketID] = data.roomID
      let pc = createReceiverPeerConnection(data.senderSocketID, socket, data.roomID)
      await pc.setRemoteDescription(data.sdp)
      let sdp = await pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
      await pc.setLocalDescription(sdp)
      socket.join(data.roomID)
      io.to(data.senderSocketID).emit('getSenderAnswer', { sdp })
    } catch (error) {
      console.log(error)
    }
  })

  socket.on('senderCandidate', async (data) => {
    console.log('[socket event called] senderCandidate, data: ', data)

    try {
      let pc = receiverPCs[data.senderSocketID]
      await pc.addIceCandidate(new wrtc.RTCIceCandidate(data.candidate))
    } catch (error) {
      console.log(error)
    }
  })

  /**
   * receiverSocketID를 socket id로 가지는 user가 senderSocketID를 socket id로 가지는
   * user의 MediaStream을 받기 위한 RTCPeerConnection의 offer를 서버가 받고 answer를 보냄
   */
  socket.on('receiverOffer', async (data) => {
    console.log('[socket event called] receiverOffer, data: ', data)

    try {
      let pc = createSenderPeerConnection(
        data.receiverSocketID,
        data.senderSocketID,
        socket,
        data.roomID
      )
      await pc.setRemoteDescription(data.sdp)
      let sdp = await pc.createAnswer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      })
      await pc.setLocalDescription(sdp)
      io.to(data.receiverSocketID).emit('getReceiverAnswer', {
        id: data.senderSocketID,
        sdp,
      })
    } catch (error) {
      console.log(error)
    }
  })

  socket.on('receiverCandidate', async (data) => {
    console.log('[socket event called] receiverCandidate, data: ', data)

    try {
      const senderPC = senderPCs[data.senderSocketID].filter(
        (sPC) => sPC.id === data.receiverSocketID
      )
      await senderPC[0].pc.addIceCandidate(new wrtc.RTCIceCandidate(data.candidate))
    } catch (error) {
      console.log(error)
    }
  })

  socket.on('disconnect', () => {
    console.log('[socket event called] disconnect, data: ', data)

    try {
      let roomID = socketToRoom[socket.id]

      deleteUser(socket.id, roomID)
      closeRecevierPC(socket.id)
      closeSenderPCs(socket.id)

      socket.broadcast.to(roomID).emit('userExit', { id: socket.id })
    } catch (error) {
      console.log(error)
    }
  })
})

server.listen(process.env.PORT || 8080, () => {
  console.log('server running on 8080')
})
