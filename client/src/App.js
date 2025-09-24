import React, { useState, useEffect } from "react";
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
  const [mode, setMode] = useState("login"); // "login" or "signup"

  // --- Load user from localStorage on app start ---
  useEffect(() => {
    const storedUser = localStorage.getItem("chatUser");
    const storedToken = localStorage.getItem("chatToken");
    if (storedUser && storedToken) {
      setUsername(storedUser);
      setToken(storedToken);
    }
  }, []);

  // --- AUTH ---
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      console.log("Sending to backend:", form);
      const url = `${SERVER_URL}/${mode}`;
      const res = await axios.post(url, form);

      setUsername(res.data.username);
      setToken(res.data.token);

      // Save to localStorage
      localStorage.setItem("chatUser", res.data.username);
      localStorage.setItem("chatToken", res.data.token);

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

  // --- SOCKET ---
  useEffect(() => {
    socket.on("receiveMessage", (message) => {
      setMessages((prev) => [...prev, message]);
    });
    return () => socket.off("receiveMessage");
  }, []);

  // --- SEND MESSAGE ---
  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    socket.emit("sendMessage", { username, text, room: "global" });
    setText("");
  };

  // --- RENDER ---
  if (!username) {
    return (
      <div style={styles.container}>
        <h2>{mode === "login" ? "Login" : "Signup"}</h2>
        
        <form onSubmit={handleAuth} style={styles.form}>
          <input
            type="text"
            placeholder={mode === "login" ? "Username or Email" : "Username"}
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
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} style={styles.message}>
            <strong>{msg.username}: </strong> {msg.text}
            <div style={styles.timestamp}>
              {new Date(msg.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage} style={styles.form}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          style={styles.input}
        />
        <button type="submit" style={styles.button}>Send</button>
      </form>
    </div>
  );
}

export default App;

// --- Inline styles ---
const styles = {
  container: { maxWidth: "600px", margin: "20px auto", padding: "10px", border: "1px solid #ccc", borderRadius: "8px", backgroundColor: "#f9f9f9" },
  header: { textAlign: "center", marginBottom: "10px" },
  messages: { height: "400px", overflowY: "auto", padding: "10px", border: "1px solid #ddd", borderRadius: "6px", background: "#fff", marginBottom: "10px" },
  message: { marginBottom: "8px", padding: "6px 8px", borderRadius: "6px", background: "#f1f1f1" },
  timestamp: { fontSize: "0.7em", color: "#666", marginTop: "2px" },
  form: { display: "flex", flexDirection: "column", gap: "8px" },
  input: { padding: "8px", borderRadius: "6px", border: "1px solid #ccc" },
  button: { padding: "8px 12px", borderRadius: "6px", border: "none", backgroundColor: "#007bff", color: "#fff", cursor: "pointer" },
  link: { background: "none", border: "none", color: "#007bff", cursor: "pointer" },
  logout: { marginLeft: "10px", padding: "4px 8px", border: "none", background: "#dc3545", color: "#fff", borderRadius: "4px", cursor: "pointer" },
};
