import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import axios from "axios";
import EmojiPicker from "emoji-picker-react";
import "./App.css";

function groupMessagesByDate(messages) {
  const groups = {};
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  for (const msg of messages) {
    const msgDate = new Date(msg.createdAt);
    const msgKey = msgDate.toDateString();

    if (!groups[msgKey]) groups[msgKey] = [];
    groups[msgKey].push(msg);
  }

  // Convert to ordered array with readable labels
  return Object.keys(groups)
    .sort((a, b) => new Date(a) - new Date(b))
    .map((dateKey) => {
      const dateObj = new Date(dateKey);
      let label;

      if (dateObj.toDateString() === today.toDateString()) label = "Today";
      else if (dateObj.toDateString() === yesterday.toDateString()) label = "Yesterday";
      else {
        const options = { month: "short", day: "numeric", year: "numeric" };
        label = dateObj.toLocaleDateString(undefined, options);
      }

      return { label, messages: groups[dateKey] };
    });
}

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3001";
const socket = io(SERVER_URL, { transports: ["websocket"] });

function formatTimestamp(dateString) {
  const d = new Date(dateString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const SingleCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="tick-icon single" viewBox="0 0 24 24">
    <path d="M4 12l5 5L20 7" fill="none" stroke="gray" strokeWidth="2" />
  </svg>
);
const DoubleCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="tick-icon double" viewBox="0 0 24 24">
    <path d="M3 12l5 5L20 5" fill="none" stroke="#00e5ff" strokeWidth="2" />
    <path d="M9 12l5 5L23 5" fill="none" stroke="#00e5ff" strokeWidth="2" />
  </svg>
);

export default function App() {
  // --- Auth state ---
  const [username, setUsername] = useState(localStorage.getItem("chatUser") || null);
  const [token, setToken] = useState(localStorage.getItem("chatToken") || null);
  const [avatar, setAvatar] = useState(localStorage.getItem("chatAvatar") || "");
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", email: "", password: "", avatar: null });

  // --- Room state ---
  const [room, setRoom] = useState(localStorage.getItem("chatRoom") || null);
  const [rooms, setRooms] = useState([]);
  const [newRoom, setNewRoom] = useState("");

  // --- Chat state ---
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);

  const [uploadingFile, setUploadingFile] = useState(null);

  // --- UI state ---
  const [darkMode, setDarkMode] = useState(localStorage.getItem("darkMode") === "true");
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);

  // --- Refs ---
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const hideTimerRef = useRef(null);

  // --- Helper functions ---
  const messagesDiv = () => messagesEndRef.current?.parentNode;
  const scrollToBottom = (behavior = "smooth") => {
    const el = messagesDiv();
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };
  const nearBottom = () => {
    const el = messagesDiv();
    if (!el) return true;
    const { scrollTop, clientHeight, scrollHeight } = el;
    return scrollHeight - scrollTop <= clientHeight + 50;
  };

  // --- On mount ---
  useEffect(() => {
  axios.get(`${SERVER_URL}/rooms`)
    .then((res) => setRooms(res.data || []))
    .catch(() => {});

  if (darkMode) document.body.classList.add("dark");

  // ✅ If user and room are saved, rejoin automatically
  const savedUser = localStorage.getItem("chatUser");
  const savedRoom = localStorage.getItem("chatRoom");
  if (savedUser && savedRoom) {
    socket.emit("joinRoom", { username: savedUser, room: savedRoom });
    axios
      .get(`${SERVER_URL}/messages?room=${encodeURIComponent(savedRoom)}`)
      .then((res) => {
        setMessages(res.data || []);
        // ✅ Auto-scroll to bottom once messages are loaded
        setTimeout(() => scrollToBottom("auto"), 150);
      })
      .catch((err) => console.error("Failed to load messages:", err));
  }
  }, []);


  // --- Auth handlers ---
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const url = `${SERVER_URL}/${mode}`;
      let res;

      if (mode === "login") {
        res = await axios.post(url, {
          username: form.username,
          password: form.password,
        });
      } else {
        const formData = new FormData();
        formData.append("username", form.username);
        formData.append("email", form.email);
        formData.append("password", form.password);
        if (form.avatar) formData.append("avatar", form.avatar);
        res = await axios.post(url, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      setUsername(res.data.username);
      setToken(res.data.token);
      setAvatar(res.data.avatar || "");
      localStorage.setItem("chatUser", res.data.username);
      localStorage.setItem("chatToken", res.data.token);
      localStorage.setItem("chatAvatar", res.data.avatar || "");
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
    localStorage.removeItem("chatAvatar");
    setRoom(null);
    localStorage.removeItem("chatRoom");
    setMessages([]);
    setOnlineUsers([]);
  };

  const toggleDarkMode = () => {
    const v = !darkMode;
    setDarkMode(v);
    document.body.classList.toggle("dark", v);
    localStorage.setItem("darkMode", v);
  };

  // --- Join room ---
  const joinRoom = async (targetRoom) => {
    const r = (targetRoom || newRoom || "").trim() || "general";
    setRoom(r);
    localStorage.setItem("chatRoom", r);

    try {
      const res = await axios.get(`${SERVER_URL}/messages?room=${encodeURIComponent(r)}`);
      setMessages(res.data || []);
      setTimeout(() => scrollToBottom("auto"), 100);
      if (username) socket.emit("joinRoom", { username, room: r });
      setTimeout(() => {
        scrollToBottom("auto");
        if (username) socket.emit("markAsRead", { username, room: r });
      }, 30);
    } catch (err) {
      console.error("Failed to load room messages:", err);
    }

    axios.get(`${SERVER_URL}/rooms`).then((res) => setRooms(res.data || [])).catch(() => {});
  };

  // --- Socket listeners ---
  useEffect(() => {
    const receiveHandler = (message) => {
      if (message.room !== room) return;

      // Remove temporary "pending" message if it matches the text
      setMessages((prev) => {
        const withoutTemp = prev.filter(
          (m) => !(m.pending && m.text === message.text && m.username === message.username)
        );
        return [...withoutTemp, message];
      });

      if (message.username === username) {
        setTimeout(() => scrollToBottom(), 40);
      } else {
        if (!nearBottom()) {
          setNewMsgCount((c) => c + 1);
          setShowNewMessages(true);
          setFadeOut(false);
        } else {
          setTimeout(() => scrollToBottom(), 40);
        }
      }
    };

    socket.on("receiveMessage", receiveHandler);
    socket.on("messageRead", (updated) => {
      if (!updated?.length || updated[0]?.room !== room) return;
      const map = new Map(updated.map((m) => [m._id, m]));
      setMessages((prev) =>
        prev.map((m) => (map.has(m._id) ? { ...m, readBy: map.get(m._id).readBy } : m))
      );
    });
    socket.on("onlineUsers", (users) => setOnlineUsers(users || []));
    socket.on("typing", (who) => {
      setTypingUser(who);
      // Reset any fade-out timer if a new typing event comes in
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    });

    socket.on("stopTyping", () => {
      // Wait 1.5s before removing the "typing" text, for smoother fade-out
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 1500);
    });

    return () => {
      socket.off("receiveMessage", receiveHandler);
      socket.off("messageRead");
      socket.off("onlineUsers");
      socket.off("typing");
      socket.off("stopTyping");
    };
  }, [room, username]);

  // --- Typing ---
  const handleTyping = (e) => {
    const v = e.target.value;
    setText(v);
    if (!username || !room) return;
    socket.emit("typing", { username, room });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit("stopTyping", { room }), 900);
  };

  // --- Send message (optimistic render) ---
  const sendMessage = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !username || !room) return;

    const tempMsg = {
      _id: "temp-" + Date.now(),
      username,
      text: t,
      room,
      createdAt: new Date().toISOString(),
      readBy: [],
      pending: true,
    };

    setMessages((prev) => [...prev, tempMsg]);
    scrollToBottom("auto");
    setText("");
    setShowEmoji(false);
    socket.emit("stopTyping", { room });
    socket.emit("sendMessage", { username, text: t, room });
  };

  const handleFileUpload = async (e) => {
  const file = e.target.files?.[0];
  if (!file || !username || !room) return;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("username", username);
  formData.append("room", room);

  // Temporary "uploading" message
  const tempId = Date.now();
  const tempMessage = {
    _id: tempId,
    username,
    avatar,
    fileName: file.name,
    file: "",
    text: "",
    createdAt: new Date(),
    uploading: true, // ✅ flag
    progress: 0,
  };
  setMessages((prev) => [...prev, tempMessage]);
  scrollToBottom();

  try {
    await axios.post(`${SERVER_URL}/upload-message`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (progressEvent) => {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setMessages((prev) =>
          prev.map((m) => (m._id === tempId ? { ...m, progress: percent } : m))
        );
      },
    });

    // Once done, backend emits real message, so no need to keep the temp one
    setMessages((prev) => prev.filter((m) => m._id !== tempId));
  } catch (err) {
    console.error("File upload failed:", err);
    alert("File upload failed");
    setMessages((prev) => prev.filter((m) => m._id !== tempId));
  } finally {
    e.target.value = null; // reset input
  }
};

  // --- Emoji ---
  const onEmojiClick = (emojiData) => {
    setText((prev) => prev + (emojiData?.emoji || ""));
  };

  // --- Auto hide new message pill ---
  useEffect(() => {
    if (!showNewMessages) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setFadeOut(true);
      setTimeout(() => {
        setShowNewMessages(false);
        setNewMsgCount(0);
      }, 500);
    }, 5000);
    return () => hideTimerRef.current && clearTimeout(hideTimerRef.current);
  }, [showNewMessages]);

  // --- Scroll (mark as read) ---
  const handleScroll = (e) => {
    const el = e.target;
    const isNear = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
    if (isNear) {
      setShowNewMessages(false);
      setNewMsgCount(0);
      hideTimerRef.current && clearTimeout(hideTimerRef.current);
      if (username && room) socket.emit("markAsRead", { username, room });
    }
  };

  // --- UI rendering ---
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
              <>
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <label style={{ display: "block", marginTop: 10 }}>
                  Choose avatar:
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setForm({ ...form, avatar: e.target.files?.[0] || null })}
                  />
                </label>
                {form.avatar && (
                  <img
                    src={URL.createObjectURL(form.avatar)}
                    alt="Preview"
                    style={{
                      width: "80px",
                      height: "80px",
                      borderRadius: "50%",
                      marginTop: "10px",
                      objectFit: "cover",
                      border: "2px solid var(--border)",
                    }}
                  />
                )}
              </>
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
            <button className="link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "Signup" : "Login"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="app">
        <div className="login" style={{ width: 420 }}>
          <h2>Choose a Room</h2>
          <div style={{ textAlign: "left", marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6 }}>Join existing:</label>
            <div className="room-list">
              {rooms.length ? (
                rooms.map((r) => (
                  <button key={r} className="room-badge" onClick={() => joinRoom(r)}>
                    #{r}
                  </button>
                ))
              ) : (
                <div className="muted">No rooms yet — create one below</div>
              )}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinRoom(newRoom);
            }}
          >
            <input
              type="text"
              placeholder="Create or join room (e.g., tech-talk)"
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
            />
            <button type="submit">Enter</button>
          </form>
          <p style={{ marginTop: 12, fontSize: "0.9em" }}>
            Logged in as <strong>{username}</strong>
          </p>
          <div style={{ marginTop: 8 }}>
            <button className="link" onClick={toggleDarkMode}>
              {darkMode ? "☀️ Light theme" : "🌙 Dark theme"}
            </button>
            <span style={{ margin: "0 8px" }}>•</span>
            <button className="link" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Chat screen ---
  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>#{room}</h2>
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
        <aside className="sidebar">
          <h4>Online in #{room}</h4>
          <ul className="online-list">
            {onlineUsers.map((u, i) => (
              <li key={i} className="online-item">
                <img
                  src={`${SERVER_URL}${u.avatar || "/uploads/default.png"}`}
                  alt={`${u.username} avatar`}
                  className="online-avatar"
                  onError={(e) => (e.target.src = `${SERVER_URL}/uploads/default.png`)}
                />
                <span>{u.username}</span>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 12 }}>
            <button
              className="link"
              onClick={() => {
                setRoom(null);
                localStorage.removeItem("chatRoom");
                setMessages([]);
              }}
            >
              ← Switch room
            </button>
          </div>
        </aside>

        <section className="messages-area">
          <div className="messages" onScroll={handleScroll}>
            {groupMessagesByDate(messages).map((group, gi) => (
              <div key={gi}>
                {/* 🗓️ Date label */}
                <div className="date-separator">{group.label}</div>

                {group.messages.map((m, i) => {
                  const mine = m.username === username;
                  const readers = (m.readBy || []).filter((u) => u !== m.username);
                  const userAvatar = mine
                    ? avatar
                    : m.avatar || `${SERVER_URL}/uploads/default.png`;

                  return (
                    <div
                      key={m._id || i}
                      className={`message ${mine ? "me" : "other"} ${m.pending ? "pending" : ""}`}
                    >
                      {!mine && (
                        <img
                          src={
                            userAvatar.startsWith("http")
                              ? userAvatar
                              : `${SERVER_URL}${userAvatar}`
                          }
                          alt={`${m.username} avatar`}
                          className="msg-avatar"
                          onError={(e) =>
                            (e.target.src = `${SERVER_URL}/uploads/default.png`)
                          }
                        />
                      )}
                      <div className="text">
                        {/* Sender name */}
                        {!mine && <strong>{m.username}: </strong>}

                        {/* Regular text message */}
                        {m.text && <span>{m.text}</span>}

                        {/* 📎 File or 📸 Image preview */}
                        {m.file && (
                          <div className="file-preview">
                            {m.file.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                              <img
                                src={`${SERVER_URL}${m.file}`}
                                alt={m.fileName}
                                className="chat-image"
                                onError={(e) => (e.target.style.display = 'none')}
                              />
                            ) : (
                              <a
                                href={`${SERVER_URL}${m.file}`}
                                download
                                className="file-link"
                                title={`Download ${m.fileName}`}
                              >
                                📎 {m.fileName}
                              </a>
                            )}
                          </div>
                        )}

                        {m.uploading && (
                          <div className="upload-progress">
                            <div className="upload-bar">
                              <div className="upload-fill" style={{ width: `${m.progress}%` }} />
                            </div>
                            <span className="upload-label">
                              Uploading… {m.progress}%
                            </span>
                          </div>
                        )}

                        {/* Timestamp and read receipts */}
                        <span className="timestamp">
                          {formatTimestamp(m.createdAt)}
                          {mine && (readers.length > 0 ? <DoubleCheck /> : <SingleCheck />)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* ✅ Typing indicator placed below messages but above composer */}
          {typingUser && (
            <div className="typing-container">
              <p className="typing">
                {typingUser} is typing
                <span className="dots">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            </div>
          )}

          {/* ✅ “New messages” pill stays separate */}
          {showNewMessages && (
            <div
              className={`newMessages ${fadeOut ? "hide" : ""}`}
              onClick={() => {
                scrollToBottom();
                setShowNewMessages(false);
                setNewMsgCount(0);
                hideTimerRef.current && clearTimeout(hideTimerRef.current);
              }}
            >
              {newMsgCount > 1 ? `${newMsgCount} New Messages ↓` : "New Message ↓"}
            </div>
          )}

          {/* ✅ Composer stays at bottom */}
          <form className="composer" onSubmit={sendMessage}>
            <div className="composer-actions">
              {/* 📎 File upload */}
              <label className="upload-btn" title="Attach file">
                📎
                <input
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => handleFileUpload(e)}
                />
              </label>

              {/* 😊 Emoji button */}
              <button
                type="button"
                className="emoji-btn"
                onClick={() => setShowEmoji((s) => !s)}
                aria-label="Emoji"
                title="Emoji"
              >
                😊
              </button>

              {showEmoji && (
                <div className="emoji-popover" onMouseDown={(e) => e.preventDefault()}>
                  <EmojiPicker onEmojiClick={(emojiData) => onEmojiClick(emojiData)} />
                </div>
              )}
            </div>

            <textarea
              value={text}
              onChange={handleTyping}
              placeholder={`Message #${room}…`}
            />
            <button type="submit">Send</button>
          </form>
        </section>
      </div>
    </div>
  );
}











