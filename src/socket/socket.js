// socket.js - Socket.io client setup

import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

export default socket; 