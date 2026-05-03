const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phục vụ các file tĩnh (bao gồm file index.html của bạn)
app.use(express.static(__dirname));

// Biến trạng thái máy chủ (Dùng chung cho TẤT CẢ mọi người)
let gameState = 'BETTING';
let timeLeft = 60;
let currentSessionId = 5409491;
let currentResult = { id: currentSessionId, dices: [1, 1, 1], total: 3, side: 'xiu' };

// Máy chủ đếm ngược thời gian và chuyển trạng thái
setInterval(() => {
    timeLeft--;

    if (gameState === 'BETTING' && timeLeft <= 0) {
        gameState = 'SHAKING';
        timeLeft = 2; // Thời gian lắc 2 giây
        io.emit('stateChange', gameState);
    } 
    else if (gameState === 'SHAKING' && timeLeft <= 0) {
        gameState = 'WAIT_OPEN';
        timeLeft = 12; // 12 giây để người chơi mở bát
        
        // Máy chủ random kết quả xúc xắc
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const d3 = Math.floor(Math.random() * 6) + 1;
        const total = d1 + d2 + d3;
        const side = (total >= 11) ? 'tai' : 'xiu';
        currentResult = { id: currentSessionId, dices: [d1, d2, d3], total, side };
        
        io.emit('result', currentResult);
        io.emit('stateChange', gameState);
    } 
    else if (gameState === 'WAIT_OPEN' && timeLeft <= 0) {
        gameState = 'RESULT';
        timeLeft = 5; // 5 giây hiển thị kết quả
        io.emit('stateChange', gameState);
    } 
    else if (gameState === 'RESULT' && timeLeft <= 0) {
        gameState = 'BETTING';
        timeLeft = 60; // Quay lại 60 giây đặt cược
        currentSessionId++;
        
        io.emit('newSession', currentSessionId);
        io.emit('stateChange', gameState);
    }

    // Gửi thời gian thực tế cho tất cả client
    io.emit('timer', timeLeft);
}, 1000);

// Khi có người chơi mới truy cập vào
io.on('connection', (socket) => {
    console.log('Có người chơi mới tham gia phiên!');
    // Đồng bộ ngay lập tức trạng thái hiện tại của server cho người vào sau
    socket.emit('sync', { gameState, timeLeft, currentSessionId, currentResult });
});

server.listen(3000, () => {
    console.log('Server Tài Xỉu đang chạy tại http://localhost:3000');
});
