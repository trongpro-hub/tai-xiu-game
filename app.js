const socket = io();

let currentUser = '';
let balance = 0;
let usedCodes = [];

let gameState = 'BETTING';
let timeLeft = 60;
let selectedZone = null;
let currentBet = { tai: 0, xiu: 0 };
let historyData = [];
let currentSessionId = 5409491;
let currentResult = { id: currentSessionId, total: 0, side: '', dices: [1, 1, 1] };
let showDice = { 1: true, 2: true, 3: true };

const timerEl = document.getElementById('timerDisplay');
const statusEl = document.getElementById('statusText');
const bowlEl = document.getElementById('bowl');
const balanceEl = document.getElementById('balanceDisplay');
const btnBet = document.getElementById('btnBet');
const betInputEl = document.getElementById('betInput');
const currentUserText = document.getElementById('currentUserText');

function showToast(msg, type = "info") {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = type === 'success' ? `✅ ${msg}` : type === 'error' ? `❌ ${msg}` : `🔔 ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function togglePopup(id, show) {
  document.getElementById(id).style.display = show ? 'flex' : 'none';
  if (id === 'withdrawOverlay' && show) {
    const avail = document.getElementById('availBalance');
    if (avail) avail.innerText = balance.toLocaleString() + ' VNĐ';
  }
  if (id === 'accountOverlay' && show) {
    updateCurrentUserLabel();
  }
}

function updateCurrentUserLabel() {
  currentUserText.innerText = currentUser ? currentUser : 'chưa đăng nhập';
}

function updateBalance() {
  balanceEl.innerText = Number(balance || 0).toLocaleString();
  const avail = document.getElementById('availBalance');
  if (avail) avail.innerText = Number(balance || 0).toLocaleString() + ' VNĐ';
}

function requireLogin() {
  if (currentUser) return true;
  showToast("Bạn phải tạo tài khoản rồi mới được chơi!", "error");
  openAccountRequired();
  return false;
}

function openAccountRequired() {
  togglePopup('accountOverlay', true);
  betInputEl.disabled = true;
  btnBet.disabled = true;
}

function updateUIFromState() {
  updateBalance();
  updateCurrentUserLabel();

  timerEl.innerText = gameState === 'BETTING' || gameState === 'WAIT_OPEN' ? timeLeft : '';

  statusEl.innerText =
    gameState === 'BETTING' ? 'PHIÊN MỚI' :
    gameState === 'SHAKING' ? 'ĐANG LẮC' :
    gameState === 'WAIT_OPEN' ? 'MỜI MỞ BÁT' :
    gameState === 'RESULT' ? `${currentResult.side.toUpperCase()} - ${currentResult.total}` :
    'PHIÊN MỚI';

  statusEl.style.color = gameState === 'RESULT'
    ? (currentResult.side === 'tai' ? '#ff4b2b' : '#00b4db')
    : '#ffd700';

  document.getElementById('bet-tai').innerText = (currentBet.tai || 0).toLocaleString();
  document.getElementById('bet-xiu').innerText = (currentBet.xiu || 0).toLocaleString();

  document.querySelectorAll('.bet-zone').forEach(el => el.classList.remove('selected'));
  if (selectedZone) {
    const z = document.getElementById('zone-' + selectedZone);
    if (z) z.classList.add('selected');
  }

  if (gameState === 'SHAKING') {
    bowlEl.classList.add('shaking');
  } else {
    bowlEl.classList.remove('shaking');
  }

  btnBet.disabled = !currentUser || gameState !== 'BETTING';
  betInputEl.disabled = !currentUser || gameState !== 'BETTING';

  if (gameState === 'WAIT_OPEN' || gameState === 'RESULT') {
    const d1 = currentResult?.dices?.[0] || 1;
    const d2 = currentResult?.dices?.[1] || 1;
    const d3 = currentResult?.dices?.[2] || 1;
    renderDice('d1', d1);
    renderDice('d2', d2);
    renderDice('d3', d3);
    initDrag();
  }

  bowlEl.style.opacity = gameState === 'RESULT' ? '0' : '1';
  drawTotalChart();
  drawDiceChart();
}

function registerAccount() {
  const user = document.getElementById('accUser').value.trim();
  const pass = document.getElementById('accPass').value.trim();
  if (!user || !pass) return showToast("Vui lòng nhập đủ tài khoản và mật khẩu!", "error");

  socket.emit('auth:register', { username: user, password: pass }, (res) => {
    if (!res || !res.ok) return showToast(res?.error || 'Không tạo được tài khoản!', 'error');
    document.getElementById('accUser').value = '';
    document.getElementById('accPass').value = '';
    togglePopup('accountOverlay', false);
    showToast(`Đã tạo và đăng nhập: ${user}`, 'success');
  });
}

function loginAccount() {
  const user = document.getElementById('accUser').value.trim();
  const pass = document.getElementById('accPass').value.trim();
  if (!user || !pass) return showToast("Vui lòng nhập đủ tài khoản và mật khẩu!", "error");

  socket.emit('auth:login', { username: user, password: pass }, (res) => {
    if (!res || !res.ok) return showToast(res?.error || 'Sai tài khoản hoặc mật khẩu!', 'error');
    document.getElementById('accUser').value = '';
    document.getElementById('accPass').value = '';
    togglePopup('accountOverlay', false);
    showToast(`Đã đăng nhập: ${user}`, 'success');
  });
}

function logoutAccount() {
  socket.emit('auth:logout', {}, (res) => {
    if (!res || !res.ok) return;
    showToast("Đã đăng xuất!", "success");
  });
}

function redeemCode() {
  if (!requireLogin()) return;
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  if (!code) return showToast("Vui lòng nhập mã!", "error");

  socket.emit('code:redeem', { code }, (res) => {
    if (!res || !res.ok) return showToast(res?.error || 'Mã Giftcode không hợp lệ!', "error");
    document.getElementById('codeInput').value = '';
    togglePopup('codeOverlay', false);
    showToast(`Nhận thành công ${Number(res.amount).toLocaleString()} VNĐ!`, "success");
  });
}

function withdrawMoney() {
  if (!requireLogin()) return;
  const amt = parseInt(document.getElementById('withdrawInput').value, 10);
  if (isNaN(amt) || amt <= 0) return showToast("Số tiền không hợp lệ!", "error");

  socket.emit('wallet:withdraw', { amount: amt }, (res) => {
    if (!res || !res.ok) return showToast(res?.error || 'Không rút được!', 'error');
    document.getElementById('withdrawInput').value = '';
    togglePopup('withdrawOverlay', false);
    showToast(`Đã tạo lệnh rút ${Number(res.amount).toLocaleString()} VNĐ thành công!`, "success");
  });
}

function selectZone(z) {
  if (!requireLogin()) return;
  if (gameState !== 'BETTING') return;
  selectedZone = z;
  document.querySelectorAll('.bet-zone').forEach(el => el.classList.remove('selected'));
  document.getElementById('zone-' + z).classList.add('selected');
}

function allIn() {
  if (!requireLogin()) return;
  if (gameState === 'BETTING' && balance > 0) {
    document.getElementById('betInput').value = balance;
  }
}

function placeBet() {
  if (!requireLogin()) return;
  const val = parseInt(document.getElementById('betInput').value, 10);

  if (gameState !== 'BETTING') return showToast("Đã hết thời gian cược!", "error");
  if (!selectedZone) return showToast("Vui lòng chọn cửa Tài hoặc Xỉu!", "error");
  if (isNaN(val) || val <= 0) return showToast("Số tiền cược không hợp lệ!", "error");

  socket.emit('bet:place', { side: selectedZone, amount: val }, (res) => {
    if (!res || !res.ok) return showToast(res?.error || 'Không đặt cược được!', "error");
    document.getElementById('betInput').value = '';
    showToast(`Đã cược ${Number(val).toLocaleString()} vào ${selectedZone.toUpperCase()}`, "success");
  });
}

const dicePatterns = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

function renderDice(id, num) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  el.style.transform = `rotate(${Math.floor(Math.random() * 360)}deg)`;

  for (let i = 0; i < 9; i++) {
    const dot = document.createElement('div');
    if (dicePatterns[num].includes(i)) {
      dot.className = 'dot' + (num === 1 || num === 4 ? ' red' : '');
    }
    el.appendChild(dot);
  }
}

function initDices() {
  renderDice('d1', 1);
  renderDice('d2', 2);
  renderDice('d3', 3);
}

let isDragging = false;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

function initDrag() {
  bowlEl.onmousedown = null;
  bowlEl.ontouchstart = null;
  window.onmousemove = null;
  window.onmouseup = null;
  window.ontouchmove = null;
  window.ontouchend = null;

  const startDrag = (e) => {
    if (gameState !== 'WAIT_OPEN') return;
    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX - currentX;
    startY = clientY - currentY;
    timerEl.style.opacity = "0";
  };

  const drag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    currentX = clientX - startX;
    currentY = clientY - startY;
    bowlEl.style.transform = `translate(${currentX}px, ${currentY}px)`;
  };

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    bowlEl.style.transition = "0.3s";
    bowlEl.style.transform = "translate(0px, 0px)";
    currentX = 0;
    currentY = 0;
    timerEl.style.opacity = "1";
  };

  bowlEl.onmousedown = startDrag;
  window.onmousemove = drag;
  window.onmouseup = endDrag;
  bowlEl.ontouchstart = startDrag;
  window.ontouchmove = drag;
  window.ontouchend = endDrag;
}

function toggleLine(diceNum) {
  showDice[diceNum] = !showDice[diceNum];
  document.getElementById(`tg-d${diceNum}`).classList.toggle('active');
  drawDiceChart();
}

function openChart() {
  if (!requireLogin()) return;
  togglePopup('chartOverlay', true);

  if (historyData.length > 0) {
    const last = historyData[historyData.length - 1];
    document.getElementById('sessionInfoId').innerText = last.id;
    document.getElementById('sessionInfoRes').innerText = `${last.side.toUpperCase()}(${last.dices[0]}-${last.dices[1]}-${last.dices[2]})`;
  }
  drawTotalChart();
  drawDiceChart();
}

function drawGrid(ctx, canvas, stepsY) {
  const padX = 20, padY = 20;
  const stepX = (canvas.width - padX * 2) / 19;
  const stepY = (canvas.height - padY * 2) / stepsY;

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;

  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    ctx.moveTo(padX + i * stepX, padY);
    ctx.lineTo(padX + i * stepX, canvas.height - padY);
    ctx.stroke();
  }

  for (let i = 0; i <= stepsY; i++) {
    ctx.beginPath();
    ctx.moveTo(padX, padY + i * stepY);
    ctx.lineTo(canvas.width - padX, padY + i * stepY);
    ctx.stroke();
  }

  return { padX, padY, stepX, stepY };
}

function drawTotalChart() {
  const cv = document.getElementById('totalCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const { padX, padY, stepX, stepY } = drawGrid(ctx, cv, 15);

  if (historyData.length === 0) return;

  ctx.beginPath();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  historyData.forEach((data, i) => {
    const x = padX + i * stepX;
    const y = padY + (18 - data.total) * stepY;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  historyData.forEach((data, i) => {
    const x = padX + i * stepX;
    const y = padY + (18 - data.total) * stepY;

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = data.side === 'tai' ? '#ff4b2b' : '#00b4db';
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(data.total, x, y - 10);
  });
}

function drawDiceChart() {
  const cv = document.getElementById('diceCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const { padX, padY, stepX, stepY } = drawGrid(ctx, cv, 5);

  if (historyData.length === 0) return;

  const colors = { 1: '#ff0044', 2: '#b200ff', 3: '#ffcc00' };

  function drawDieLine(dieIndex, color) {
    if (!showDice[dieIndex + 1]) return;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";

    historyData.forEach((data, i) => {
      const val = data.dices[dieIndex];
      const x = padX + i * stepX;
      const y = padY + (6 - val) * stepY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    historyData.forEach((data, i) => {
      const val = data.dices[dieIndex];
      const x = padX + i * stepX;
      const y = padY + (6 - val) * stepY;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  drawDieLine(0, colors[1]);
  drawDieLine(1, colors[2]);
  drawDieLine(2, colors[3]);
}

socket.on('game:state', (state) => {
  gameState = state.phase;
  timeLeft = state.timeLeft;
  currentSessionId = state.roundId;
  currentResult = state.currentResult || { id: currentSessionId, total: 0, side: '', dices: [1, 1, 1] };
  currentBet = state.currentBets || { tai: 0, xiu: 0 };
  historyData = Array.isArray(state.history) ? state.history : [];
  updateUIFromState();
});

socket.on('user:profile', (profile) => {
  if (!profile) {
    currentUser = '';
    balance = 0;
    usedCodes = [];
    updateCurrentUserLabel();
    updateBalance();
    openAccountRequired();
    return;
  }

  currentUser = profile.username || '';
  balance = Number(profile.balance || 0);
  usedCodes = Array.isArray(profile.usedCodes) ? profile.usedCodes : [];
  updateCurrentUserLabel();
  updateBalance();
  betInputEl.disabled = gameState !== 'BETTING';
  btnBet.disabled = gameState !== 'BETTING';
});

initDices();
openAccountRequired();
updateCurrentUserLabel();
updateBalance();

window.togglePopup = togglePopup;
window.registerAccount = registerAccount;
window.loginAccount = loginAccount;
window.logoutAccount = logoutAccount;
window.redeemCode = redeemCode;
window.withdrawMoney = withdrawMoney;
window.selectZone = selectZone;
window.allIn = allIn;
window.placeBet = placeBet;
window.openChart = openChart;
window.toggleLine = toggleLine;
