import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";
import "./App.css";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3001";
const socket = io(SERVER_URL, { transports: ["websocket"] });

function formatTimestamp(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function App() {
  const [username, setUsername] = useState(null);
  const [token, setToken] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [mode, setMode] = useState("login");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);

  // 🌙 Dark Mode
  const [darkMode, setDarkMode] = useState(false);

  // 🔔 New Messages notification
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);

  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const hideTimerRef = useRef(null);

  // --- Load session + dark mode ---
  useEffect(() => {
    const storedUser = localStorage.getItem("chatUser");
    const storedToken = localStorage.getItem("chatToken");
    const storedTheme = localStorage.getItem("darkMode");

    if (storedUser && storedToken) {
      setUsername(storedUser);
      setToken(storedToken);
      socket.emit("joinRoom", { username: storedUser });
    }

    if (storedTheme === "true") {
      setDarkMode(true);
      document.body.classList.add("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    document.body.classList.toggle("dark", newMode);
    localStorage.setItem("darkMode", newMode);
  };

  // --- AUTH ---
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const url = `${SERVER_URL}/${mode}`;
      const res = await axios.post(url, form);

      setUsername(res.data.username);
      setToken(res.data.token);

      localStorage.setItem("chatUser", res.data.username);
      localStorage.setItem("chatToken", res.data.token);

      socket.emit("joinRoom", { username: res.data.username });
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

  // --- LOAD MESSAGES ---
  useEffect(() => {
    if (!username) return;
    const fetchMessages = async () => {
      try {
        const res = await axios.get(`${SERVER_URL}/messages`);
        setMessages(res.data);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      }
    };
    fetchMessages();
  }, [username]);

  // --- SOCKET ---
  useEffect(() => {
    socket.on("receiveMessage", (message) => {
      setMessages((prev) => [...prev, message]);

      if (message.username !== username) {
        const messagesDiv = messagesEndRef.current?.parentNode;
        if (messagesDiv) {
          const { scrollTop, clientHeight, scrollHeight } = messagesDiv;
          if (scrollHeight - scrollTop > clientHeight + 50) {
            setNewMsgCount((prev) => prev + 1);
            setShowNewMessages(true);
            setFadeOut(false);
          } else {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
  }, [username]);

  // --- AUTO-HIDE TIMER (separate useEffect) ---
  useEffect(() => {
    if (showNewMessages) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      hideTimerRef.current = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => {
          setShowNewMessages(false);
          setNewMsgCount(0);
        }, 500);
      }, 5000);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showNewMessages]);

  // --- SCROLL HANDLER ---
  const handleScroll = (e) => {
    const { scrollTop, clientHeight, scrollHeight } = e.target;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      setShowNewMessages(false);
      setNewMsgCount(0);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  };

  // --- SEND MESSAGE ---
  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    socket.emit("sendMessage", { username, text });
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

  // --- RENDER ---
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
            <button type="submit">{mode === "login" ? "Login" : "Signup"}</button>
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
          <button
            className="toggle-dark"
            onClick={toggleDarkMode}
            data-tooltip={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            <span className={`mode-icon ${darkMode ? "fade-out" : "fade-in"}`}>
              {darkMode ? "☀️ Light" : "🌙 Dark"}
            </span>
          </button>
          <button className="logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="chat-main">
        <div className="sidebar">
          <h4>Online Users</h4>
          <ul>{onlineUsers.map((user, i) => <li key={i}>{user}</li>)}</ul>
        </div>

        <div className="messages-area">
          <div className="messages" onScroll={handleScroll}>
            {messages.map((msg, i) => {
              const isMine = msg.username === username;
              return (
                <div key={i} className={`message ${isMine ? "me" : "other"}`}>
                  <div className="text">
                    {!isMine && <strong>{msg.username}: </strong>} {msg.text}
                    <span className="timestamp">
                      {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {typingUser && <div className="typing">{typingUser} is typing...</div>}

          {showNewMessages && (
            <div
              className={`newMessages ${fadeOut ? "hide" : ""}`}
              onClick={() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                setShowNewMessages(false);
                setNewMsgCount(0);
                if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              }}
            >
              {newMsgCount > 1
                ? `${newMsgCount} New Messages ↓`
                : "New Message ↓"}
            </div>
          )}

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
