const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const START_BALANCE = 0;
const BETTING_SECONDS = 60;
const SHAKING_SECONDS = 2;
const WAIT_OPEN_SECONDS = 12;
const RESULT_SECONDS = 3;

const GIFT_CODES = {
  VIPPRO: 500000,
  TANTHU: 200000,
  CODEVIP: 1000000,
  KHOILOAN: 1000000000
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2), 'utf8');

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function hashPass(pass) {
  return crypto.createHash('sha256').update(String(pass)).digest('hex');
}

let users = readUsers();

let game = {
  phase: 'BETTING',
  timeLeft: BETTING_SECONDS,
  roundId: 5409491,
  currentResult: null,
  currentBets: { tai: 0, xiu: 0 },
  history: []
};

const onlineCounts = new Map();
let liveFeed = [];

function ensureUser(username) {
  if (!users[username]) {
    users[username] = {
      passHash: '',
      balance: START_BALANCE,
      usedCodes: [],
      roundBets: {}
    };
  }

  if (typeof users[username].balance !== 'number') users[username].balance = START_BALANCE;
  if (!Array.isArray(users[username].usedCodes)) users[username].usedCodes = [];
  if (!users[username].roundBets || typeof users[username].roundBets !== 'object') {
    users[username].roundBets = {};
  }
}

function profileOf(username) {
  const u = users[username];
  if (!u) return null;
  return {
    username,
    balance: u.balance || 0,
    usedCodes: Array.isArray(u.usedCodes) ? u.usedCodes : []
  };
}

function publicState() {
  return {
    phase: game.phase,
    timeLeft: game.timeLeft,
    roundId: game.roundId,
    currentResult: game.currentResult,
    currentBets: game.currentBets,
    history: game.history
  };
}

function emitGameState() {
  io.emit('game:state', publicState());
}

function emitOnlineList() {
  io.emit('online:list', Array.from(onlineCounts.keys()));
}

function addOnline(username) {
  if (!username) return;
  onlineCounts.set(username, (onlineCounts.get(username) || 0) + 1);
  emitOnlineList();
}

function removeOnline(username) {
  if (!username) return;
  const n = (onlineCounts.get(username) || 0) - 1;
  if (n <= 0) onlineCounts.delete(username);
  else onlineCounts.set(username, n);
  emitOnlineList();
}

function attachSocketUser(socket, username) {
  if (socket.data.username && socket.data.username !== username) {
    removeOnline(socket.data.username);
  }
  socket.data.username = username;
  addOnline(username);
}

function detachSocketUser(socket) {
  if (socket.data.username) {
    removeOnline(socket.data.username);
    socket.data.username = null;
  }
}

function pushLiveMessage(text) {
  const item = { id: `${Date.now()}_${Math.random()}`, text, ts: Date.now() };
  liveFeed.push(item);
  if (liveFeed.length > 50) liveFeed.shift();
  io.emit('live:message', item);
}

function newDiceResult(roundId) {
  const dices = [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1
  ];
  const total = dices[0] + dices[1] + dices[2];
  const side = total >= 11 ? 'tai' : 'xiu';
  return { id: roundId, total, side, dices };
}

function settleRound() {
  const result = game.currentResult;
  if (!result) return;

  game.history.push(result);
  if (game.history.length > 20) game.history.shift();

  for (const username of Object.keys(users)) {
    const u = users[username];
    const bet = u.roundBets?.[String(result.id)];
    if (!bet) continue;

    const winAmt = Number(bet[result.side] || 0);
    if (winAmt > 0) {
      u.balance += winAmt * 1.98;
    }

    delete u.roundBets[String(result.id)];
  }

  saveUsers();
  pushLiveMessage(`Phiên #${result.id} ra ${result.side.toUpperCase()} - ${result.total}`);
}

function nextRound() {
  game.roundId += 1;
  game.phase = 'BETTING';
  game.timeLeft = BETTING_SECONDS;
  game.currentResult = null;
  game.currentBets = { tai: 0, xiu: 0 };
  pushLiveMessage(`Bắt đầu phiên #${game.roundId}`);
}

function tick() {
  if (game.phase === 'BETTING') {
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) {
      game.phase = 'SHAKING';
      game.timeLeft = SHAKING_SECONDS;
      pushLiveMessage(`Phiên #${game.roundId} bắt đầu lắc`);
    }
  } else if (game.phase === 'SHAKING') {
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) {
      game.currentResult = newDiceResult(game.roundId);
      game.phase = 'WAIT_OPEN';
      game.timeLeft = WAIT_OPEN_SECONDS;
      pushLiveMessage(`Phiên #${game.roundId} mời mở bát`);
    }
  } else if (game.phase === 'WAIT_OPEN') {
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) {
      settleRound();
      game.phase = 'RESULT';
      game.timeLeft = RESULT_SECONDS;
    }
  } else if (game.phase === 'RESULT') {
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) {
      nextRound();
    }
  }

  emitGameState();
}

app.use(express.static(PUBLIC_DIR));

io.on('connection', (socket) => {
  socket.data.username = null;

  socket.emit('game:state', publicState());
  socket.emit('live:history', liveFeed);
  socket.emit('online:list', Array.from(onlineCounts.keys()));

  socket.on('auth:register', ({ username, password }, cb = () => {}) => {
    try {
      username = String(username || '').trim();
      password = String(password || '').trim();

      if (!username || !password) return cb({ ok: false, error: 'Vui lòng nhập đủ tài khoản và mật khẩu!' });
      if (users[username]) return cb({ ok: false, error: 'Tài khoản đã tồn tại!' });

      users[username] = {
        passHash: hashPass(password),
        balance: START_BALANCE,
        usedCodes: [],
        roundBets: {}
      };

      saveUsers();
      attachSocketUser(socket, username);
      socket.emit('user:profile', profileOf(username));
      pushLiveMessage(`${username} vừa tạo tài khoản`);
      cb({ ok: true });
    } catch {
      cb({ ok: false, error: 'Không tạo được tài khoản!' });
    }
  });

  socket.on('auth:login', ({ username, password }, cb = () => {}) => {
    try {
      username = String(username || '').trim();
      password = String(password || '').trim();

      if (!username || !password) return cb({ ok: false, error: 'Vui lòng nhập đủ tài khoản và mật khẩu!' });
      if (!users[username]) return cb({ ok: false, error: 'Sai tài khoản hoặc mật khẩu!' });
      if (users[username].passHash !== hashPass(password)) return cb({ ok: false, error: 'Sai tài khoản hoặc mật khẩu!' });

      ensureUser(username);
      attachSocketUser(socket, username);
      socket.emit('user:profile', profileOf(username));
      pushLiveMessage(`${username} đã đăng nhập`);
      cb({ ok: true });
    } catch {
      cb({ ok: false, error: 'Không đăng nhập được!' });
    }
  });

  socket.on('auth:logout', (_, cb = () => {}) => {
    if (socket.data.username) pushLiveMessage(`${socket.data.username} đã đăng xuất`);
    detachSocketUser(socket);
    socket.emit('user:profile', null);
    cb({ ok: true });
  });

  socket.on('code:redeem', ({ code }, cb = () => {}) => {
    try {
      if (!socket.data.username) return cb({ ok: false, error: 'Bạn phải đăng nhập trước!' });

      const username = socket.data.username;
      ensureUser(username);

      code = String(code || '').trim().toUpperCase();
      if (!code) return cb({ ok: false, error: 'Vui lòng nhập mã!' });
      if (users[username].usedCodes.includes(code)) return cb({ ok: false, error: 'Mã này bạn đã dùng rồi!' });
      if (!GIFT_CODES[code]) return cb({ ok: false, error: 'Mã Giftcode không hợp lệ!' });

      users[username].balance += GIFT_CODES[code];
      users[username].usedCodes.push(code);
      saveUsers();
      socket.emit('user:profile', profileOf(username));
      pushLiveMessage(`${username} đã nhập giftcode ${code}`);
      cb({ ok: true, amount: GIFT_CODES[code] });
    } catch {
      cb({ ok: false, error: 'Không nhận được giftcode!' });
    }
  });

  socket.on('wallet:withdraw', ({ amount }, cb = () => {}) => {
    try {
      if (!socket.data.username) return cb({ ok: false, error: 'Bạn phải đăng nhập trước!' });

      amount = parseInt(amount, 10);
      if (isNaN(amount) || amount <= 0) return cb({ ok: false, error: 'Số tiền không hợp lệ!' });

      const username = socket.data.username;
      ensureUser(username);

      if (amount > users[username].balance) return cb({ ok: false, error: 'Số dư không đủ để rút!' });

      users[username].balance -= amount;
      saveUsers();
      socket.emit('user:profile', profileOf(username));
      pushLiveMessage(`${username} vừa tạo lệnh rút ${amount.toLocaleString()} VNĐ`);
      cb({ ok: true, amount });
    } catch {
      cb({ ok: false, error: 'Không tạo được lệnh rút!' });
    }
  });

  socket.on('bet:place', ({ side, amount }, cb = () => {}) => {
    try {
      if (!socket.data.username) return cb({ ok: false, error: 'Bạn phải đăng nhập trước!' });
      if (game.phase !== 'BETTING') return cb({ ok: false, error: 'Đã hết thời gian cược!' });

      side = String(side || '').toLowerCase();
      amount = parseInt(amount, 10);

      if (side !== 'tai' && side !== 'xiu') return cb({ ok: false, error: 'Cửa cược không hợp lệ!' });
      if (isNaN(amount) || amount <= 0) return cb({ ok: false, error: 'Số tiền cược không hợp lệ!' });

      const username = socket.data.username;
      ensureUser(username);

      if (amount > users[username].balance) return cb({ ok: false, error: 'Số dư không đủ!' });

      users[username].balance -= amount;

      if (!users[username].roundBets[String(game.roundId)]) {
        users[username].roundBets[String(game.roundId)] = { tai: 0, xiu: 0 };
      }

      users[username].roundBets[String(game.roundId)][side] += amount;
      game.currentBets[side] += amount;

      saveUsers();
      socket.emit('user:profile', profileOf(username));
      pushLiveMessage(`${username} vừa cược ${amount.toLocaleString()} vào ${side.toUpperCase()}`);
      emitGameState();
      cb({ ok: true });
    } catch {
      cb({ ok: false, error: 'Không đặt cược được!' });
    }
  });

  socket.on('disconnect', () => {
    detachSocketUser(socket);
  });
});

pushLiveMessage(`Bắt đầu phiên #${game.roundId}`);
setInterval(tick, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server đang chạy tại port ${PORT}`);
});
