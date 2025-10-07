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

// ✅ SVG Check Components
const SingleCheck = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="tick-icon single"
    viewBox="0 0 24 24"
  >
    <path d="M4 12l5 5L20 7" fill="none" stroke="gray" strokeWidth="2" />
  </svg>
);

const DoubleCheck = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="tick-icon double"
    viewBox="0 0 24 24"
  >
    <path d="M3 12l5 5L20 5" fill="none" stroke="#00e5ff" strokeWidth="2" />
    <path d="M9 12l5 5L23 5" fill="none" stroke="#00e5ff" strokeWidth="2" />
  </svg>
);

function App() {
  const [username, setUsername] = useState(null);
  const [token, setToken] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [mode, setMode] = useState("login");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);

  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const hideTimerRef = useRef(null);

  // ✅ Smooth reliable scroll-to-bottom function
  const scrollToBottom = () => {
    const messagesDiv = messagesEndRef.current?.parentNode;
    if (messagesDiv) {
      messagesDiv.scrollTo({
        top: messagesDiv.scrollHeight,
        behavior: "smooth",
      });
    }
  };

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
        setTimeout(scrollToBottom, 50); // ✅ ensures we scroll after render
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      }
    };
    fetchMessages();
  }, [username]);

  // --- SOCKET LISTENERS ---
  useEffect(() => {
    socket.on("receiveMessage", (message) => {
      setMessages((prev) => [...prev, message]);

      if (message.username === username) {
        // ✅ Scroll after new message renders
        setTimeout(scrollToBottom, 60);
      } else {
        const messagesDiv = messagesEndRef.current?.parentNode;
        if (messagesDiv) {
          const { scrollTop, clientHeight, scrollHeight } = messagesDiv;
          const isNearBottom = scrollHeight - scrollTop <= clientHeight + 50;

          if (!isNearBottom) {
            setNewMsgCount((prev) => prev + 1);
            setShowNewMessages(true);
            setFadeOut(false);
          } else {
            setTimeout(scrollToBottom, 60);
          }
        }
      }
    });

    socket.on("messageRead", (updatedMessages) => {
      setMessages((prevMessages) => {
        const updates = new Map(updatedMessages.map((m) => [m._id, m]));
        return prevMessages.map((msg) => {
          const updated = updates.get(msg._id);
          if (updated) {
            return { ...msg, readBy: [...updated.readBy] };
          }
          return msg;
        });
      });
    });

    socket.on("onlineUsers", (users) => setOnlineUsers(users));
    socket.on("typing", (user) => setTypingUser(user));
    socket.on("stopTyping", () => setTypingUser(null));

    return () => {
      socket.off("receiveMessage");
      socket.off("messageRead");
      socket.off("onlineUsers");
      socket.off("typing");
      socket.off("stopTyping");
    };
  }, [username]);

  // --- AUTO-HIDE TIMER ---
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

  const handleScroll = (e) => {
    const { scrollTop, clientHeight, scrollHeight } = e.target;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      setShowNewMessages(false);
      setNewMsgCount(0);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      socket.emit("markAsRead", { username });
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    socket.emit("sendMessage", { username, text });
    setText("");
    socket.emit("stopTyping");
    setTimeout(scrollToBottom, 50); // ✅ ensures full bubble visible
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
          <button className="toggle-dark" onClick={toggleDarkMode}>
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
          <ul>{onlineUsers.map((user, i) => <li key={i}>{user}</li>)}</ul>
        </div>

        <div className="messages-area">
          <div className="messages" onScroll={handleScroll}>
            {messages.map((msg, i) => {
              const isMine = msg.username === username;
              const readers = msg.readBy?.filter((u) => u !== msg.username) || [];

              return (
                <div key={msg._id || i} className={`message ${isMine ? "me" : "other"}`}>
                  <div className="text">
                    {!isMine && <strong>{msg.username}: </strong>} {msg.text}
                    <span className="timestamp">
                      {formatTimestamp(msg.createdAt)}
                      {isMine && (readers.length ? <DoubleCheck /> : <SingleCheck />)}
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
                scrollToBottom();
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





