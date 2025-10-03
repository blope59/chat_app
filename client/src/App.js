import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";
import "./App.css";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3001";
const socket = io(SERVER_URL, { transports: ["websocket"] });

// timestamp formatter
function formatTimestamp(dateString) {
  const date = new Date(dateString);
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupMessagesByDate(messages) {
  const groups = {};
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  for (const msg of messages) {
    const msgDate = new Date(msg.createdAt);
    let label;

    if (
      msgDate.getDate() === today.getDate() &&
      msgDate.getMonth() === today.getMonth() &&
      msgDate.getFullYear() === today.getFullYear()
    ) {
      label = "Today";
    } else if (
      msgDate.getDate() === yesterday.getDate() &&
      msgDate.getMonth() === yesterday.getMonth() &&
      msgDate.getFullYear() === yesterday.getFullYear()
    ) {
      label = "Yesterday";
    } else {
      label = msgDate.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(msg);
  }

  return groups;
}

function App() {
  const [username, setUsername] = useState(null);
  const [token, setToken] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [mode, setMode] = useState("login");
  const [darkMode, setDarkMode] = useState(
    localStorage.getItem("darkMode") === "true"
  );

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("chatUser");
    const storedToken = localStorage.getItem("chatToken");
    if (storedUser && storedToken) {
      setUsername(storedUser);
      setToken(storedToken);
      socket.emit("join", storedUser);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const url = `${SERVER_URL}/${mode}`;
      const res = await axios.post(url, form);

      setUsername(res.data.username);
      setToken(res.data.token);

      localStorage.setItem("chatUser", res.data.username);
      localStorage.setItem("chatToken", res.data.token);

      socket.emit("join", res.data.username);
    } catch (err) {
      alert(err.response?.data?.error || "Auth failed");
    }
  };

  const handleLogout = () => {
    setUsername(null);
    setToken(null);
    localStorage.removeItem("chatUser");
    localStorage.removeItem("chatToken");
  };

  useEffect(() => {
    if (!username) return;
    const fetchMessages = async () => {
      try {
        const res = await axios.get(`${SERVER_URL}/messages`);
        setMessages(res.data);
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      }
    };
    fetchMessages();
  }, [username]);

  useEffect(() => {
    socket.on("receiveMessage", (message) => {
      setMessages((prev) => [...prev, message]);
      if (!isNearBottom()) {
        setShowNewMessages(true);
      }
    });

    socket.on("onlineUsers", (users) => setOnlineUsers(users));
    socket.on("typing", (user) => setTypingUser(user));
    socket.on("stopTyping", () => setTypingUser(null));

    return () => {
      socket.off("receiveMessage");
      socket.off("onlineUsers");
      socket.off("typing");
      socket.off("stopTyping");
    };
  }, []);

  const isNearBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight < 100
    );
  };

  useEffect(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowNewMessages(false);
    }
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    socket.emit("sendMessage", { username, text, room: "global" });
    setText("");
    socket.emit("stopTyping");
  };

  const handleTyping = (e) => {
    setText(e.target.value);
    if (username) {
      socket.emit("typing", username);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("stopTyping");
      }, 1000);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowNewMessages(false);
  };

  if (!username) {
    return (
      <div className="app">
        <div className="login">
          <h2>{mode === "login" ? "Login" : "Signup"}</h2>
          <form onSubmit={handleAuth}>
            <input
              type="text"
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            {mode === "signup" && (
              <input
                type="email"
                placeholder="Email"
                value={form.email || ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
            <input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button type="submit">
              {mode === "login" ? "Login" : "Signup"}
            </button>
          </form>
          <p>
            {mode === "login" ? "Don't have an account?" : "Already registered?"}{" "}
            <button
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="link"
            >
              {mode === "login" ? "Signup" : "Login"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>Welcome, {username} 👋</h2>
        <div>
          <button className="toggle-dark" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button className="logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="chat-main">
        <div className="sidebar">
          <h4>Online Users</h4>
          <ul>
            {onlineUsers.map((user, i) => (
              <li key={i}>{user}</li>
            ))}
          </ul>
        </div>

        <div className="messages-area">
          <div className="messages" ref={messagesContainerRef}>
            {Object.entries(groupMessagesByDate(messages)).map(
              ([dateLabel, msgs], i) => (
                <div key={i}>
                  <div className="date-row">
                    <span className="date-label">{dateLabel}</span>
                  </div>
                  {msgs.map((msg, j) => {
                    const isMine = msg.username === username;
                    return (
                      <div key={j} className={`message ${isMine ? "me" : "other"}`}>
                        <div className="text">
                          {!isMine && <strong>{msg.username}: </strong>} {msg.text}
                          <span className="timestamp">
                            {formatTimestamp(msg.createdAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
            <div ref={messagesEndRef} />
          </div>

          {showNewMessages && (
            <div className="newMessages" onClick={scrollToBottom}>
              ⬇️ New Messages
            </div>
          )}

          {typingUser && <div className="typing">{typingUser} is typing...</div>}

          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={text}
              onChange={handleTyping}
              placeholder="Type a message..."
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;


