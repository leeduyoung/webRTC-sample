let express = require('express');
let http = require('http');
let app = express();
let cors = require('cors');
let server = http.createServer(app);
let socketio = require('socket.io');
let io = socketio.listen(server);

app.use(cors());
const PORT = process.env.PORT || 8080;

let users = {};
let socketToRoom = {};
const maximum = 2; // 한 방의 최대 인원

// 1. 연결
io.on('connection', (socket) => {
  // users[room]에는 room에 있는 사용자들이 배열 형태로 저장된다.
  socket.on('join_room', (data) => {
    // 방이 존재할 경우
    if (users[data.room]) {
      const length = users[data.room].length;

      // 방에 최대인원 가득찼을 경우
      if (length === maximum) {
        socket.to(socket.id).emit('room_full');
        return;
      }

      // 방에 최대인원이 가득차지 않았을 경우
      users[data.room].push({ id: socket.id, email: data.email });
    } else {
      // 방이 존재하지 않을경우 생성
      users[data.room] = [{ id: socket.id, email: data.email }];
    }
    // 해당 소켓이 어느 방과 연결되어 있는지 저장한다.
    socketToRoom[socket.id] = data.room;

    socket.join(data.room);
    console.log(`[방 번호 - ${socketToRoom[socket.id]}]: ${socket.id} 입장`);

    // 본일을 제외한 현재방의 유저목록
    const usersInThisRoom = users[data.room].filter(
      (user) => user.id !== socket.id,
    );

    console.log('현재 방의 유저목록 - ', usersInThisRoom);

    io.sockets.to(socket.id).emit('all_users', usersInThisRoom);
  });

  // 2. 다른 User들에게 참여 offer를 보냄(SDP, Session Description Protocol)
  socket.on('offer', (sdp) => {
    console.log('신규 유저 입장 - ', socket.id);
    socket.broadcast.emit('getOffer', sdp);
  });

  // 3. offer를 보낸 User에게 answer를 보냄(SDP)
  socket.on('answer', (sdp) => {
    console.log('기존 유저 응답 - ', socket.id);
    socket.broadcast.emit('getAnswer', sdp);
  });

  // 4. 자신의 ICECandidate 정보를 signal을 주고 받은 상대에게 전달
  socket.on('candidate', (candidate) => {
    console.log('candidate: ' + socket.id);
    socket.broadcast.emit('getCandidate', candidate);
  });

  // 5. 연결끊기
  socket.on('disconnect', () => {
    console.log(`방 번호 - [${socketToRoom[socket.id]}]: ${socket.id} 퇴장`);

    // 소켓 아이디를 사용하여 방 검색
    const roomID = socketToRoom[socket.id];

    // 방에 포함된 유저 검색
    let room = users[roomID];

    // 방이 존재할 경우
    if (room) {
      // 방에서 나간 유저 필터
      room = room.filter((user) => user.id !== socket.id);
      users[roomID] = room;
      if (room.length === 0) {
        delete users[roomID];
        return;
      }
    }
    // 어떤 유저가 나갔는지 현재 방에 다른 user들에게 알림
    socket.broadcast.to(room).emit('user_exit', { id: socket.id });
    console.log(users);
  });
});

server.listen(PORT, () => {
  console.log(`server running on ${PORT}`);
});
