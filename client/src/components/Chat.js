import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';
let socket;

export default function Chat({ user, onLeave }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [online, setOnline] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [room] = useState(user.room || 'global');

  const inputRef = useRef();

  useEffect(() => {
    socket = io(SERVER_URL, { autoConnect: false });
    socket.connect();

    socket.emit('joinRoom', { username: user.username, room });

    fetch(`${SERVER_URL}/messages?room=${encodeURIComponent(room)}&limit=200`)
      .then((r) => r.json())
      .then((data) => setMessages(data || []))
      .catch(() => {});

    socket.on('receiveMessage', (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (msg.username) {
        setTypingUsers((t) => {
          const copy = { ...t };
          delete copy[msg.username];
          return copy;
        });
      }
    });

    socket.on('onlineUsers', (list) => setOnline(list || []));
    socket.on('typing', ({ username, isTyping }) => {
      setTypingUsers((t) => {
        const copy = { ...t };
        if (isTyping) copy[username] = true;
        else delete copy[username];
        return copy;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [room, user.username]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (!socket) return;
    socket.emit('typing', { isTyping: true });
    setTimeout(() => socket.emit('typing', { isTyping: false }), 700);
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !socket) return;
    socket.emit('sendMessage', { text, room });
    setInput('');
    inputRef.current?.focus();
    socket.emit('typing', { isTyping: false });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <div>
          <h3>Room: {room}</h3>
          <p className="small">You: {user.username}</p>
        </div>
        <div className="header-actions">
          <button onClick={() => { socket.disconnect(); onLeave(); }}>Leave</button>
        </div>
      </header>

      <main className="chat-main">
        <aside className="sidebar">
          <h4>Online</h4>
          <ul>{online.map((u, i) => <li key={i}>{u}</li>)}</ul>
          {Object.keys(typingUsers).length > 0 && (
            <p>{Object.keys(typingUsers).join(', ')} typing...</p>
          )}
        </aside>

        <section className="messages-area">
          <div id="messages" className="messages">
            {messages.map((m, idx) => (
              <div key={idx} className={`message ${m.system ? 'system' : (m.username === user.username ? 'me' : '')}`}>
                {!m.system && (
                  <div className="meta">
                    <strong>{m.username}</strong>
                    <span className="time">{new Date(m.createdAt).toLocaleTimeString()}</span>
                  </div>
                )}
                <div className="text">{m.text}</div>
                {m.system && <div className="sys">{m.text}</div>}
              </div>
            ))}
          </div>

          <div className="composer">
            <textarea
              ref={inputRef}
              placeholder="Type a message (Enter to send)"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
            />
            <button onClick={sendMessage}>Send</button>
          </div>
        </section>
      </main>
    </div>
  );
}
