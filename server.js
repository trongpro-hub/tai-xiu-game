const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const GIFT_CODES = {
  VIPPRO: 500000,
  TANTHU: 200000,
  CODEVIP: 1000000,
  KHOILOAN: 1000000000
};

const START_BALANCE = 0;
const BETTING_SECONDS = 60;
const SHAKING_SECONDS = 2;
const WAIT_OPEN_SECONDS = 12;
const RESULT_SECONDS = 3;

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_HASH = hashPass('admin123'); // Change 'admin123' to your desired password

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

/*
  users structure:
  {
    username: {
      passHash: "...",
      balance: 0,
      usedCodes: [],
      roundBets: {
        "5409491": { tai: 0, xiu: 0 }
      }
    }
  }
*/

let game = {
  phase: 'BETTING',
  timeLeft: BETTING_SECONDS,
  roundId: 5409491,
  currentResult: null,
  currentBets: { tai: 0, xiu: 0 },
  history: []
};

let forcedTotal = null;

function newDiceResult(roundId) {
  let total;
  let dices;
  if (forcedTotal !== null && forcedTotal >= 3 && forcedTotal <= 18) {
    total = forcedTotal;
    // Generate dices that sum to total
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    let d3 = total - d1 - d2;
    if (d3 < 1) d3 = 1;
    if (d3 > 6) d3 = 6;
    // Adjust if needed, but for simplicity, keep as is
    dices = [d1, d2, d3];
  } else {
    dices = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1
    ];
    total = dices[0] + dices[1] + dices[2];
  }
  const side = total >= 11 ? 'tai' : 'xiu';
  return { id: roundId, total, side, dices };
}

function getRoundPlayerStats(roundId) {
  let taiPlayers = 0;
  let xiuPlayers = 0;

  for (const username of Object.keys(users)) {
    const bet = users[username].roundBets?.[roundId];
    if (!bet) continue;
    if (Number(bet.tai) > 0) taiPlayers += 1;
    if (Number(bet.xiu) > 0) xiuPlayers += 1;
  }

  return { taiPlayers, xiuPlayers };
}

function getAllBets(roundId) {
  const allBets = {};
  for (const username of Object.keys(users)) {
    const bet = users[username].roundBets?.[roundId];
    if (bet) {
      allBets[username] = bet;
    }
  }
  return allBets;
}

function publicState() {
  const playerStats = getRoundPlayerStats(game.roundId);
  return {
    phase: game.phase,
    timeLeft: game.timeLeft,
    roundId: game.roundId,
    currentResult: game.currentResult,
    currentBets: game.currentBets,
    totalBets: {
      tai: game.currentBets.tai,
      xiu: game.currentBets.xiu,
      taiPlayers: playerStats.taiPlayers,
      xiuPlayers: playerStats.xiuPlayers
    },
    history: game.history
  };
}

function profileOf(username) {
  const u = users[username];
  if (!u) return null;
  return {
    username,
    balance: u.balance || 0,
    usedCodes: Array.isArray(u.usedCodes) ? u.usedCodes : [],
    roundBets: u.roundBets || {},
    isAdmin: username === ADMIN_USERNAME
  };
}

function emitGameState() {
  io.emit('game:state', publicState());
  // Emit all bets to admin sockets
  const allBets = getAllBets(game.roundId);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.username === ADMIN_USERNAME) {
      socket.emit('admin:bets', allBets);
    }
  }
}

function emitProfile(socket, username) {
  socket.emit('user:profile', profileOf(username));
}

function broadcastProfiles() {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.username) {
      emitProfile(socket, socket.data.username);
    }
  }
}

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
  if (!users[username].roundBets || typeof users[username].roundBets !== 'object') users[username].roundBets = {};
}

function settleRound() {
  const result = game.currentResult;
  if (!result) return;

  game.history.push(result);
  if (game.history.length > 20) game.history.shift();

  for (const username of Object.keys(users)) {
    const u = users[username];
    const bet = u.roundBets?.[result.id];
    if (!bet) continue;

    const winAmount = Number(bet[result.side] || 0);
    if (winAmount > 0) {
      u.balance += winAmount * 1.98;
    }

    delete u.roundBets[result.id];
  }

  saveUsers();
  broadcastProfiles();
}

function startNextRound() {
  game.roundId += 1;
  game.phase = 'BETTING';
  game.timeLeft = BETTING_SECONDS;
  game.currentResult = null;
  game.currentBets = { tai: 0, xiu: 0 };
  forcedTotal = null; // Reset forced total for new round
  // Gửi signal cho client reset state
  io.emit('game:roundChanged', { roundId: game.roundId });
}

function tick() {
  if (game.phase === 'BETTING') {
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) {
      game.phase = 'SHAKING';
      game.timeLeft = SHAKING_SECONDS;
    }
  } else if (game.phase === 'SHAKING') {
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) {
      game.currentResult = newDiceResult(game.roundId);
      forcedTotal = null; // Reset after using
      game.phase = 'WAIT_OPEN';
      game.timeLeft = WAIT_OPEN_SECONDS;
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
      startNextRound();
    }
  }

  emitGameState();
}

app.use(express.static(__dirname));
app.use(express.static(PUBLIC_DIR));

io.on('connection', (socket) => {
  socket.data.username = null;
  socket.emit('game:state', publicState());

  socket.on('auth:register', ({ username, password }, cb = () => {}) => {
    try {
      username = String(username || '').trim();
      password = String(password || '').trim();

      if (!username || !password) return cb({ ok: false, error: 'Vui lòng nhập đủ tài khoản và mật khẩu!' });
      
      if (username === ADMIN_USERNAME) return cb({ ok: false, error: 'Tên tài khoản này không được phép!' });
      
      // Kiểm tra username duy nhất
      if (users[username]) return cb({ ok: false, error: 'Tên tài khoản này đã được sử dụng! Vui lòng chọn tên khác.' });

      users[username] = {
        passHash: hashPass(password),
        balance: START_BALANCE,
        usedCodes: [],
        roundBets: {}
      };

      socket.data.username = username;
      saveUsers();
      emitProfile(socket, username);
      socket.emit('game:state', publicState());
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
      if (username === ADMIN_USERNAME) {
        if (hashPass(password) !== ADMIN_PASSWORD_HASH) return cb({ ok: false, error: 'Sai tài khoản hoặc mật khẩu!' });
      } else {
        if (!users[username]) return cb({ ok: false, error: 'Sai tài khoản hoặc mật khẩu!' });
        if (users[username].passHash !== hashPass(password)) return cb({ ok: false, error: 'Sai tài khoản hoặc mật khẩu!' });
      }

      ensureUser(username);
      socket.data.username = username;
      emitProfile(socket, username);
      socket.emit('game:state', publicState());
      cb({ ok: true });
    } catch {
      cb({ ok: false, error: 'Không đăng nhập được!' });
    }
  });

  socket.on('auth:logout', (_, cb = () => {}) => {
    socket.data.username = null;
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
      emitProfile(socket, username);
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
      emitProfile(socket, username);
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
      if (side !== 'tai' && side !== 'xiu') return cb({ ok: false, error: 'Cửa cược không hợp lệ!' });

      amount = parseInt(amount, 10);
      if (isNaN(amount) || amount <= 0) return cb({ ok: false, error: 'Số tiền cược không hợp lệ!' });

      const username = socket.data.username;
      ensureUser(username);

      if (amount > users[username].balance) return cb({ ok: false, error: 'Số dư không đủ!' });

      users[username].balance -= amount;
      if (!users[username].roundBets[game.roundId]) {
        users[username].roundBets[game.roundId] = { tai: 0, xiu: 0 };
      }
      users[username].roundBets[game.roundId][side] += amount;
      game.currentBets[side] += amount;

      saveUsers();
      emitProfile(socket, username);
      emitGameState();
      cb({ ok: true });
    } catch {
      cb({ ok: false, error: 'Không đặt cược được!' });
    }
  });

  socket.on('admin:setDice', ({ total }, cb = () => {}) => {
    try {
      if (socket.data.username !== ADMIN_USERNAME) return cb({ ok: false, error: 'Không có quyền!' });
      total = parseInt(total, 10);
      if (isNaN(total) || total < 3 || total > 18) return cb({ ok: false, error: 'Tổng không hợp lệ!' });
      if (game.phase !== 'BETTING' && game.phase !== 'SHAKING') return cb({ ok: false, error: 'Không thể thay đổi lúc này!' });
      forcedTotal = total;
      cb({ ok: true });
    } catch {
      cb({ ok: false, error: 'Không thể đặt tổng!' });
    }
  });
});

setInterval(tick, 1000);

server.listen(3000, () => {
  console.log('Server đang chạy tại http://localhost:3000');
});
