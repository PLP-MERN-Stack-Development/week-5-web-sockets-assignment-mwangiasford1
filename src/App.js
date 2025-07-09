import React, { useEffect, useState, useRef } from 'react';
import socket from './socket/socket';

const REACTIONS = ['👍', '❤️', '😂', '😮', '🎉'];
const PAGE_SIZE = 20;
const NOTIF_SOUND_URL = 'https://www.soundjay.com/buttons/sounds/button-3.mp3'; // Short notification sound

function App() {
  const [username, setUsername] = useState('');
  const [inputName, setInputName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [privateRecipient, setPrivateRecipient] = useState(null);
  const [readReceipts, setReadReceipts] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const typingTimeout = useRef(null);
  const isTyping = useRef(false);
  const audioRef = useRef(null);
  const [darkMode, setDarkMode] = useState(false);
  // Removed showEmojiPicker state

  // Request notification permission on mount
  useEffect(() => {
    if (window.Notification && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  // Fetch latest messages on load
  useEffect(() => {
    if (!username) return;
    setLoading(true);
    fetch(`http://localhost:5000/api/messages?offset=0&limit=${PAGE_SIZE}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages || []);
        setOffset(data.messages.length);
        setHasMore(data.total > data.messages.length);
        setLoading(false);
      });
  }, [username]);

  // Load more messages
  const handleLoadMore = () => {
    setLoading(true);
    fetch(`http://localhost:5000/api/messages?offset=${offset}&limit=${PAGE_SIZE}`)
      .then(res => res.json())
      .then(data => {
        setMessages(prev => [...data.messages, ...prev]);
        setOffset(offset + data.messages.length);
        setHasMore(data.total > offset + data.messages.length);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!username) return;
    socket.emit('user_join', username);

    socket.on('connect', () => {
      console.log('Connected to server!');
    });

    // Helper: play sound
    const playSound = () => {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
    };

    // Helper: show browser notification
    const showNotification = (title, body) => {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    };

    // New message handler (public, private, file)
    const handleNewMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
      // Only notify if not sent by self
      if (msg.sender !== username) {
        playSound();
        showNotification(
          msg.sender ? `${msg.sender} says:` : 'New message',
          msg.message || (msg.fileName ? `Sent an image: ${msg.fileName}` : 'New message')
        );
      }
    };

    socket.on('receive_message', handleNewMessage);
    socket.on('private_message', (msg) => handleNewMessage({ ...msg, isPrivate: true }));
    socket.on('file_message', handleNewMessage);

    socket.on('user_list', (userList) => {
      setUsers(userList);
    });

    socket.on('typing_users', (usersTyping) => {
      setTypingUsers(usersTyping.filter((name) => name !== username));
    });

    socket.on('reaction', ({ messageId, emoji, user }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                reactions: {
                  ...msg.reactions,
                  [emoji]: msg.reactions && msg.reactions[emoji]
                    ? [...new Set([...msg.reactions[emoji], user])]
                    : [user],
                },
              }
            : msg
        )
      );
    });

    socket.on('read_receipt', ({ messageId, readers }) => {
      setReadReceipts((prev) => ({ ...prev, [messageId]: readers }));
    });

    return () => {
      socket.off('connect');
      socket.off('receive_message', handleNewMessage);
      socket.off('private_message');
      socket.off('user_list');
      socket.off('typing_users');
      socket.off('reaction');
      socket.off('read_receipt');
      socket.off('file_message', handleNewMessage);
    };
  }, [username]);

  const handleSend = (e) => {
    e.preventDefault();
    if (imageFile) {
      const reader = new FileReader();
      reader.onload = () => {
        const fileData = reader.result;
        if (privateRecipient) {
          socket.emit('send_file', {
            to: privateRecipient.id,
            file: fileData,
            fileType: imageFile.type,
            fileName: imageFile.name,
            isPrivate: true,
          });
        } else {
          socket.emit('send_file', {
            file: fileData,
            fileType: imageFile.type,
            fileName: imageFile.name,
            isPrivate: false,
          });
        }
        setImageFile(null);
      };
      reader.readAsDataURL(imageFile);
      setMessage('');
      sendTyping(false);
      return;
    }
    if (message.trim() !== '') {
      if (privateRecipient) {
        socket.emit('private_message', { to: privateRecipient.id, message });
      } else {
        socket.emit('send_message', { message });
      }
      setMessage('');
      sendTyping(false);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (inputName.trim() !== '') {
      setUsername(inputName.trim());
    }
  };

  // Typing indicator logic
  const handleTyping = (e) => {
    setMessage(e.target.value);
    if (!isTyping.current) {
      sendTyping(true);
      isTyping.current = true;
    }
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      sendTyping(false);
      isTyping.current = false;
    }, 1200);
  };

  const sendTyping = (typing) => {
    socket.emit('typing', typing);
  };

  const handleSelectUser = (user) => {
    if (user.username !== username) {
      setPrivateRecipient(user);
      setTypingUsers([]); // Hide typing indicator for private chat
    }
  };

  const handleBackToPublic = () => {
    setPrivateRecipient(null);
  };

  // Handle message reaction
  const handleReact = (messageId, emoji) => {
    socket.emit('reaction', { messageId, emoji, user: username });
  };

  // Handle file input change
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setImageFile(file);
    } else {
      alert('Only image files are supported.');
    }
  };

  // Emit read event for visible messages
  useEffect(() => {
    if (!username) return;
    // Only emit for messages currently shown in the chat area
    const visibleMessages = messages.filter(msg => {
      if (privateRecipient) {
        return (
          msg.isPrivate &&
          ((msg.sender === username && msg.senderId === socket.id && msg.receiver === privateRecipient.username) ||
            (msg.sender === privateRecipient.username && msg.senderId === privateRecipient.id && msg.receiver === username))
        );
      } else {
        return !msg.isPrivate;
      }
    });
    visibleMessages.forEach(msg => {
      if (!readReceipts[msg.id] || !readReceipts[msg.id].includes(username)) {
        socket.emit('read', { messageId: msg.id, username });
      }
    });
    // eslint-disable-next-line
  }, [messages, privateRecipient, username]);

  // Filter messages by search term
  const filteredMessages = messages.filter(msg => {
    if (!search.trim()) return true;
    const text = (msg.message || '') + ' ' + (msg.fileName || '');
    return text.toLowerCase().includes(search.toLowerCase());
  });

  // Removed addEmoji function

  if (!username) {
    return (
      <div style={{ maxWidth: 400, margin: '4rem auto', padding: 24, border: '1px solid #ccc', borderRadius: 8 }}>
        <h2>Enter your username to join the chat</h2>
        <form onSubmit={handleJoin} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={inputName}
            onChange={e => setInputName(e.target.value)}
            placeholder="Username"
            style={{ flex: 1, padding: 8 }}
            autoFocus
          />
          <button type="submit" style={{ padding: '8px 16px' }}>Join</button>
        </form>
      </div>
    );
  }

  return (
    <>
      {/* Dark Mode & Responsive styles */}
      <style>{`
        html, body, #root {
          height: 100%;
          margin: 0;
          padding: 0;
        }
        body {
          min-height: 100vh;
          min-width: 100vw;
          height: 100vh;
          width: 100vw;
          background: ${darkMode ? 'linear-gradient(135deg, #232526 0%, #414345 100%)' : 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)'};
          color: ${darkMode ? '#f5f7fa' : '#222'};
        }
        .chat-container {
          min-height: 90vh;
          min-width: 90vw;
          height: 90vh;
          width: 90vw;
          max-width: 1100px;
          margin: auto;
          display: flex;
          flex-direction: row;
          align-items: stretch;
          background: ${darkMode ? '#23272f' : '#fff'};
          box-shadow: 0 4px 24px rgba(60, 72, 88, 0.12);
          border-radius: 16px;
        }
        .user-list {
          background: ${darkMode ? '#2c313a' : '#f0f4f8'};
          border-radius: 16px 0 0 16px;
          padding: 24px 12px;
          min-width: 220px;
          max-width: 260px;
          display: flex;
          flex-direction: column;
        }
        .chat-area {
          background: ${darkMode ? '#23272f' : '#f9fbfd'};
          border-radius: 0 16px 16px 0;
          padding: 24px 24px 16px 24px;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .chat-area input[type='text'], .chat-area input[type='file'], .chat-area textarea {
          border: 1px solid ${darkMode ? '#444' : '#b0bec5'};
          border-radius: 6px;
          background: ${darkMode ? '#23272f' : '#f5f7fa'};
          color: ${darkMode ? '#f5f7fa' : '#222'};
        }
        .chat-area button, .user-list button {
          background: linear-gradient(90deg, ${darkMode ? '#232526 0%, #414345 100%' : '#1976d2 0%, #42a5f5 100%'});
          color: #fff;
          border: none;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(25, 118, 210, 0.08);
          transition: background 0.2s, box-shadow 0.2s;
        }
        .chat-area button:hover, .user-list button:hover {
          background: linear-gradient(90deg, ${darkMode ? '#232526 0%, #23272f 100%' : '#1565c0 0%, #1e88e5 100%'});
          box-shadow: 0 4px 16px rgba(25, 118, 210, 0.16);
        }
        .user-list li {
          border-radius: 4px;
          padding: 4px 8px;
          margin-bottom: 2px;
        }
        .user-list li[style*='(You)'] {
          background: ${darkMode ? '#313a4d' : '#e3f2fd'};
        }
        @media (max-width: 1100px) {
          .chat-container {
            min-width: 98vw;
            width: 98vw;
            padding: 0;
          }
        }
        @media (max-width: 800px) {
          .chat-container {
            flex-direction: column !important;
            min-width: 100vw;
            width: 100vw;
            min-height: 100vh;
            height: 100vh;
            border-radius: 0;
            padding: 0;
          }
          .user-list {
            min-width: 0 !important;
            width: 100% !important;
            border-radius: 0 0 16px 16px;
            margin-bottom: 16px !important;
            padding: 16px 8px;
          }
          .chat-area {
            width: 100% !important;
            border-radius: 0 0 16px 16px;
            padding: 16px 8px 8px 8px;
          }
        }
        @media (max-width: 500px) {
          .chat-container {
            padding: 0 !important;
            min-width: 100vw;
            width: 100vw;
            min-height: 100vh;
            height: 100vh;
          }
          .chat-area input[type='text'], .chat-area input[type='file'] {
            font-size: 1rem !important;
          }
          .chat-area button, .user-list button {
            font-size: 1rem !important;
            padding: 8px 8px !important;
          }
        }
      `}</style>
      {/* Dark mode toggle button */}
      <button
        onClick={() => setDarkMode((d) => !d)}
        style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 1000,
          padding: '8px 18px',
          fontWeight: 600,
          fontSize: 16,
          background: darkMode
            ? 'linear-gradient(90deg, #232526 0%, #414345 100%)'
            : 'linear-gradient(90deg, #1976d2 0%, #42a5f5 100%)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(25, 118, 210, 0.08)',
          cursor: 'pointer',
        }}
      >
        {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
      </button>
      <div className="chat-container" style={{ maxWidth: 700, margin: '2rem auto', padding: 20, border: '1px solid #ccc', borderRadius: 8, display: 'flex', gap: 24, background: '#fff', boxSizing: 'border-box' }}>
        {/* Online Users List */}
        <div className="user-list" style={{ minWidth: 180 }}>
          <h3 style={{ marginTop: 0 }}>Online Users</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {users.length === 0 ? (
              <li style={{ color: '#888' }}>No users online</li>
            ) : (
              users.map((user) => (
                <li
                  key={user.id}
                  style={{
                    fontWeight: user.username === username ? 'bold' : 'normal',
                    color: user.username === username ? '#1976d2' : '#222',
                    cursor: user.username !== username ? 'pointer' : 'default',
                    background: privateRecipient && privateRecipient.id === user.id ? '#e3f2fd' : 'transparent',
                    borderRadius: 4,
                    padding: '2px 4px',
                  }}
                  onClick={() => handleSelectUser(user)}
                  title={user.username !== username ? 'Send private message' : ''}
                >
                  {user.username} {user.username === username ? '(You)' : ''}
                  {privateRecipient && privateRecipient.id === user.id && ' (Private)'}
                </li>
              ))
            )}
          </ul>
        </div>
        {/* Chat Area */}
        <div className="chat-area" style={{ flex: 1 }}>
          <h1>Welcome, {username}!</h1>
          {privateRecipient ? (
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#1976d2', fontWeight: 'bold' }}>
                Private chat with {privateRecipient.username}
              </span>
              <button onClick={handleBackToPublic} style={{ marginLeft: 12, padding: '2px 8px', fontSize: 12 }}>
                Back to public chat
              </button>
            </div>
          ) : null}
          {/* Search input */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search messages..."
            style={{ width: '100%', marginBottom: 8, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
          />
          <div style={{ minHeight: 200, border: '1px solid #eee', padding: 10, marginBottom: 10, borderRadius: 4, background: '#fafafa', maxHeight: 300, overflowY: 'auto' }}>
            {hasMore && !privateRecipient && (
              <button onClick={handleLoadMore} disabled={loading} style={{ marginBottom: 8, width: '100%' }}>
                {loading ? 'Loading...' : 'Load more'}
              </button>
            )}
            {filteredMessages.length === 0 ? (
              <div style={{ color: '#888' }}>No messages found.</div>
            ) : (
              filteredMessages
                .filter(msg => {
                  if (privateRecipient) {
                    // Show only private messages between the two users
                    return (
                      msg.isPrivate &&
                      ((msg.sender === username && msg.senderId === socket.id && msg.receiver === privateRecipient.username) ||
                        (msg.sender === privateRecipient.username && msg.senderId === privateRecipient.id && msg.receiver === username))
                    );
                  } else {
                    // Show only public messages
                    return !msg.isPrivate;
                  }
                })
                .map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      margin: '6px 0',
                      background: msg.isPrivate ? '#fff3e0' : 'transparent',
                      borderRadius: 4,
                      padding: msg.isPrivate ? '2px 6px' : 0,
                    }}
                  >
                    <strong>{msg.sender || 'Anonymous'}{msg.isPrivate ? ' (private)' : ''}:</strong>{' '}
                    {/* Image or text message */}
                    {msg.file && msg.fileType && msg.fileType.startsWith('image/') ? (
                      <img src={msg.file} alt={msg.fileName || 'shared'} style={{ maxWidth: 180, maxHeight: 120, verticalAlign: 'middle', borderRadius: 4, margin: '0 4px' }} />
                    ) : (
                      msg.message
                    )}
                    {/* Reactions */}
                    <div style={{ display: 'inline-block', marginLeft: 8 }}>
                      {REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            fontSize: 18,
                            marginRight: 2,
                            opacity: 0.7,
                          }}
                          title={`React with ${emoji}`}
                          onClick={() => handleReact(msg.id, emoji)}
                          type="button"
                        >
                          {emoji}
                          {msg.reactions && msg.reactions[emoji] && (
                            <span style={{ fontSize: 13, marginLeft: 2 }}>
                              {msg.reactions[emoji].length}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {/* Read receipts */}
                    {readReceipts[msg.id] && readReceipts[msg.id].length > 0 && (
                      <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
                        ✓✓ Read by {readReceipts[msg.id].join(', ')}
                      </span>
                    )}
                  </div>
                ))
            )}
            {/* Typing indicator (only for public chat) */}
            {!privateRecipient && typingUsers.length > 0 && (
              <div style={{ color: '#888', fontStyle: 'italic', marginTop: 8 }}>
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}
          </div>
          <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
            <input
              type="text"
              value={message}
              onChange={handleTyping}
              placeholder={privateRecipient ? `Message @${privateRecipient.username}...` : 'Type your message...'}
              style={{ flex: 1, padding: 8 }}
            />
            {/* Removed emoji picker button and picker */}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              id="file-input"
            />
            <label htmlFor="file-input" style={{ cursor: 'pointer', marginRight: 8 }}>
              <span role="img" aria-label="Attach image" style={{ fontSize: 22 }}>
                📎
              </span>
            </label>
            {imageFile && (
              <span style={{ fontSize: 12, color: '#1976d2', marginRight: 8 }}>{imageFile.name}</span>
            )}
            <button type="submit" style={{ padding: '8px 16px' }}>Send</button>
          </form>
        </div>
        <audio ref={audioRef} src={NOTIF_SOUND_URL} preload="auto" style={{ display: 'none' }} />
      </div>
    </>
  );
}

export default App; 