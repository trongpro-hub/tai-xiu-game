const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const TICK_MS = 1000;
const BETTING_SECONDS = 60;
const SHAKING_SECONDS = 2;
const OPEN_SECONDS = 12;
const RESULT_SECONDS = 3;

const state = {
  phase: 'BETTING',          // BETTING | SHAKING | WAIT_OPEN | RESULT
  timeLeft: BETTING_SECONDS,
  shakeLeft: 0,
  openLeft: OPEN_SECONDS,
  resultLeft: 0,
  currentSessionId: 5409491,
  currentResult: { id: 5409491, total: 0, side: '', dices: [1, 1, 1] },
  historyData: []
};

function newRoundResult() {
  const d = [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1
  ];
  const total = d[0] + d[1] + d[2];
  state.currentSessionId += 1;
  state.currentResult = {
    id: state.currentSessionId,
    total,
    side: total >= 11 ? 'tai' : 'xiu',
    dices: d
  };
}

function pushHistory() {
  state.historyData.push(state.currentResult);
  if (state.historyData.length > 20) state.historyData.shift();
}

function advanceState() {
  if (state.phase === 'BETTING') {
    state.timeLeft -= 1;
    if (state.timeLeft <= 0) {
      state.phase = 'SHAKING';
      state.shakeLeft = SHAKING_SECONDS;
    }
  } else if (state.phase === 'SHAKING') {
    state.shakeLeft -= 1;
    if (state.shakeLeft <= 0) {
      state.phase = 'WAIT_OPEN';
      state.openLeft = OPEN_SECONDS;
      newRoundResult();
    }
  } else if (state.phase === 'WAIT_OPEN') {
    state.openLeft -= 1;
    if (state.openLeft <= 0) {
      state.phase = 'RESULT';
      state.resultLeft = RESULT_SECONDS;
      pushHistory();
    }
  } else if (state.phase === 'RESULT') {
    state.resultLeft -= 1;
    if (state.resultLeft <= 0) {
      state.phase = 'BETTING';
      state.timeLeft = BETTING_SECONDS;
      state.shakeLeft = 0;
      state.openLeft = OPEN_SECONDS;
      state.resultLeft = 0;
    }
  }
}

setInterval(() => {
  advanceState();
  io.emit('sync-state', state);
}, TICK_MS);

io.on('connection', (socket) => {
  socket.emit('sync-state', state);

  socket.on('request-state', () => {
    socket.emit('sync-state', state);
  });
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});