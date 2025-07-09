// server.js - Main server file for Socket.io chat application

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
];

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and messages
const users = {};
const messages = [];
const typingUsers = {};
const messageReads = {}; // { messageId: [username, ...] }

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining
  socket.on('user_join', (username) => {
    users[socket.id] = { username, id: socket.id };
    io.emit('user_list', Object.values(users));
    io.emit('user_joined', { username, id: socket.id });
    console.log(`${username} joined the chat`);
  });

  // Handle chat messages
  socket.on('send_message', (messageData) => {
    const message = {
      ...messageData,
      id: Date.now(),
      sender: users[socket.id]?.username || 'Anonymous',
      senderId: socket.id,
      timestamp: new Date().toISOString(),
      reactions: {},
    };
    
    messages.push(message);
    
    // Limit stored messages to prevent memory issues
    if (messages.length > 100) {
      messages.shift();
    }
    
    io.emit('receive_message', message);
  });

  // Handle message reactions
  socket.on('reaction', ({ messageId, emoji, user }) => {
    // Find the message and update its reactions
    const msg = messages.find((m) => m.id === messageId);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      if (!msg.reactions[emoji].includes(user)) {
        msg.reactions[emoji].push(user);
      }
      // Broadcast the reaction to all clients
      io.emit('reaction', { messageId, emoji, user });
    }
  });

  // Handle read receipts
  socket.on('read', ({ messageId, username }) => {
    if (!messageReads[messageId]) messageReads[messageId] = [];
    if (!messageReads[messageId].includes(username)) {
      messageReads[messageId].push(username);
      // Broadcast to all clients
      io.emit('read_receipt', { messageId, readers: messageReads[messageId] });
    }
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      const username = users[socket.id].username;
      
      if (isTyping) {
        typingUsers[socket.id] = username;
      } else {
        delete typingUsers[socket.id];
      }
      
      io.emit('typing_users', Object.values(typingUsers));
    }
  });

  // Handle private messages
  socket.on('private_message', ({ to, message }) => {
    const messageData = {
      id: Date.now(),
      sender: users[socket.id]?.username || 'Anonymous',
      senderId: socket.id,
      message,
      timestamp: new Date().toISOString(),
      isPrivate: true,
    };
    
    socket.to(to).emit('private_message', messageData);
    socket.emit('private_message', messageData);
  });

  // Handle file/image sharing
  socket.on('send_file', (data) => {
    const fileMessage = {
      id: Date.now(),
      sender: users[socket.id]?.username || 'Anonymous',
      senderId: socket.id,
      timestamp: new Date().toISOString(),
      file: data.file,
      fileType: data.fileType,
      fileName: data.fileName,
      isPrivate: data.isPrivate,
      receiver: null,
      reactions: {},
    };
    if (data.isPrivate && data.to) {
      fileMessage.receiver = users[data.to]?.username || null;
      socket.to(data.to).emit('file_message', fileMessage);
      socket.emit('file_message', fileMessage); // also show to sender
    } else {
      messages.push(fileMessage);
      io.emit('file_message', fileMessage);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { username } = users[socket.id];
      io.emit('user_left', { username, id: socket.id });
      console.log(`${username} left the chat`);
    }
    
    delete users[socket.id];
    delete typingUsers[socket.id];
    
    io.emit('user_list', Object.values(users));
    io.emit('typing_users', Object.values(typingUsers));
  });
});

// API routes
// GET /api/messages?offset=0&limit=20
app.get('/api/messages', (req, res) => {
  let { offset, limit } = req.query;
  offset = parseInt(offset) || 0;
  limit = parseInt(limit) || 20;
  // Return messages from newest to oldest
  const total = messages.length;
  const start = Math.max(total - offset - limit, 0);
  const end = total - offset;
  const paginated = messages.slice(start, end);
  res.json({
    messages: paginated,
    total,
    offset,
    limit
  });
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io }; 