import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3001";
const socket = io(SERVER_URL, { transports: ["websocket"] });

function App() {
  const [username, setUsername] = useState(null);
  const [token, setToken] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [mode, setMode] = useState("login");

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // --- Load user from localStorage ---
  useEffect(() => {
    const storedUser = localStorage.getItem("chatUser");
    const storedToken = localStorage.getItem("chatToken");
    if (storedUser && storedToken) {
      setUsername(storedUser);
      setToken(storedToken);
      socket.emit("join", storedUser);
    }
  }, []);

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

  // --- LOAD MESSAGES ---
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

  // --- SOCKET LISTENERS ---
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

  // --- Helper: check if user is near bottom ---
  const isNearBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight < 100
    );
  };

  // --- Smart Auto-scroll ---
  useEffect(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowNewMessages(false);
    }
  }, [messages]);

  // --- SEND MESSAGE ---
  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    socket.emit("sendMessage", { username, text, room: "global" });
    setText("");
    socket.emit("stopTyping");
  };

  // --- HANDLE TYPING WITH DEBOUNCE ---
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

  // --- SCROLL TO BOTTOM (manual trigger for badge) ---
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowNewMessages(false);
  };

  // --- RENDER ---
  if (!username) {
    return (
      <div style={styles.container}>
        <h2>{mode === "login" ? "Login" : "Signup"}</h2>

        <form onSubmit={handleAuth} style={styles.form}>
          <input
            type="text"
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            style={styles.input}
          />

          {mode === "signup" && (
            <input
              type="email"
              placeholder="Email"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={styles.input}
            />
          )}

          <input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            style={styles.input}
          />

          <button type="submit" style={styles.button}>
            {mode === "login" ? "Login" : "Signup"}
          </button>
        </form>

        <p>
          {mode === "login" ? "Don't have an account?" : "Already registered?"}{" "}
          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            style={styles.link}
          >
            {mode === "login" ? "Signup" : "Login"}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.header}>
        Welcome, {username} 👋
        <button onClick={handleLogout} style={styles.logout}>
          Logout
        </button>
      </h2>

      {/* Online users list */}
      <div style={styles.onlineUsers}>
        <h4>Online Users</h4>
        <ul>
          {onlineUsers.map((user, i) => (
            <li key={i}>{user}</li>
          ))}
        </ul>
      </div>

      {/* Chat messages */}
      <div style={styles.messages} ref={messagesContainerRef}>
        {messages.map((msg, i) => (
          <div key={i} style={styles.message}>
            <strong>{msg.username}: </strong> {msg.text}
            <div style={styles.timestamp}>
              {new Date(msg.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating "New Messages" badge (bottom-right) */}
      {showNewMessages && (
        <div
          style={{
            ...styles.newMessages,
            opacity: showNewMessages ? 1 : 0,
            transform: showNewMessages ? "scale(1)" : "scale(0.8)",
          }}
          onClick={scrollToBottom}
        >
          ⬇️ New Messages
        </div>
      )}

      {/* Typing indicator */}
      {typingUser && <div style={styles.typing}>{typingUser} is typing...</div>}

      {/* Message input */}
      <form onSubmit={sendMessage} style={styles.form}>
        <input
          type="text"
          value={text}
          onChange={handleTyping}
          placeholder="Type a message..."
          style={styles.input}
        />
        <button type="submit" style={styles.button}>
          Send
        </button>
      </form>
    </div>
  );
}

export default App;

// --- Inline styles ---
const styles = {
  container: {
    maxWidth: "600px",
    margin: "20px auto",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    backgroundColor: "#f9f9f9",
    position: "relative",
  },
  header: { textAlign: "center", marginBottom: "10px" },
  messages: {
    height: "300px",
    overflowY: "auto",
    padding: "10px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    background: "#fff",
    marginBottom: "10px",
    position: "relative",
  },
  message: {
    marginBottom: "8px",
    padding: "6px 8px",
    borderRadius: "6px",
    background: "#f1f1f1",
  },
  timestamp: { fontSize: "0.7em", color: "#666", marginTop: "2px" },
  form: { display: "flex", flexDirection: "column", gap: "8px" },
  input: { padding: "8px", borderRadius: "6px", border: "1px solid #ccc" },
  button: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "none",
    backgroundColor: "#007bff",
    color: "#fff",
    cursor: "pointer",
  },
  link: { background: "none", border: "none", color: "#007bff", cursor: "pointer" },
  logout: {
    marginLeft: "10px",
    padding: "4px 8px",
    border: "none",
    background: "#dc3545",
    color: "#fff",
    borderRadius: "4px",
    cursor: "pointer",
  },
  onlineUsers: {
    marginBottom: "10px",
    padding: "5px",
    background: "#eee",
    borderRadius: "6px",
  },
  typing: { fontStyle: "italic", color: "#666", marginTop: "5px" },
  newMessages: {
    position: "fixed", // 👈 pinned to viewport
    bottom: "80px",    // sits above input
    right: "20px",     // right corner
    padding: "8px 14px",
    background: "#007bff",
    color: "#fff",
    borderRadius: "20px",
    textAlign: "center",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
    transition: "opacity 0.3s ease, transform 0.3s ease", // fade + bounce
  },
};

