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

  // --- Profile UI state ---
  const [showProfile, setShowProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newAvatarFile, setNewAvatarFile] = useState(null);

  // Helper for auth header
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

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

    // ✅ Clear typing and UI state immediately
    setTypingUser(null);
    setShowEmoji(false);
    setText("");

    setRoom(r);
    localStorage.setItem("chatRoom", r);

    try {
      // Load all messages for the selected room
      const res = await axios.get(`${SERVER_URL}/messages?room=${encodeURIComponent(r)}`);
      setMessages(res.data || []);

      // Wait a short moment and scroll down automatically
      setTimeout(() => scrollToBottom("auto"), 100);

      // Join socket room and mark messages as read
      if (username) socket.emit("joinRoom", { username, room: r });
      setTimeout(() => {
        scrollToBottom("auto");
        if (username) socket.emit("markAsRead", { username, room: r });
      }, 30);
    } catch (err) {
      console.error("Failed to load room messages:", err);
    }

    // Refresh available room list
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
    socket.on("profileUpdated", (data) => {
      if (!data) return;
      // if it's me, keep my local avatar in sync
      if (data.username === username && data.avatar) {
        setAvatar(data.avatar);
        localStorage.setItem("chatAvatar", data.avatar);
      }
      // refresh sidebar avatars
      setOnlineUsers((prev) =>
        prev.map((u) => (u.username === data.username ? { ...u, avatar: data.avatar } : u))
      );
    });

    return () => {
      socket.off("receiveMessage", receiveHandler);
      socket.off("messageRead");
      socket.off("onlineUsers");
      socket.off("typing");
      socket.off("stopTyping");
      socket.off("profileUpdated");
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

  // --- Auto-hide typing indicator after 2 seconds ---
useEffect(() => {
  if (!typingUser) return; // nothing to clear if nobody's typing
  const timeout = setTimeout(() => setTypingUser(null), 2000);
  return () => clearTimeout(timeout);
}, [typingUser]);

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

  // --- Format last seen (helper) ---
  const formatLastSeen = (timestamp) => {
    if (!timestamp) return "a while ago";
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  };

  // --- UI rendering ---
  let mainContent;

  if (!username) {
    // ===== Login / Signup screen =====
    mainContent = (
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
  } else if (!room) {
    // ===== Room select screen =====
    mainContent = (
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

          {/* Theme / Profile / Logout */}
          <div style={{ marginTop: 12 }}>
            <button className="link" onClick={toggleDarkMode}>Light theme</button>
            • <button className="link" onClick={() => setShowProfile(true)}>Profile</button>
            • <button className="link" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>
    );
  } else {
    // ===== Chat screen =====
    mainContent = (
      <div className="chat-container">
        <div className="chat-header">
          <h2>#{room}</h2>
          <div>
            <button className="toggle-dark" onClick={toggleDarkMode}>
              {darkMode ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button onClick={() => setShowProfile(true)}>Profile</button>
            <button className="logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="chat-main">
          <aside className="sidebar">
            <h4>Online in #{room}</h4>
            <ul className="online-list">
              {onlineUsers.map((u) => (
                <div key={u.username} className={`user ${u.online ? "online" : "offline"}`}>
                  <img src={`${SERVER_URL}${u.avatar}`} alt={u.username} className="user-avatar" />
                  <div className="user-info">
                    <span className="username">{u.username}</span>
                    <span className={`status ${u.online ? "online" : "offline"}`}>
                      {u.online ? "🟢 Online" : `Last seen ${formatLastSeen(u.lastSeen)}`}
                    </span>
                  </div>
                </div>
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
                  <div className="date-separator">{group.label}</div>

                  {group.messages.map((m, i) => {
                    const mine = m.username === username;
                    const readers = (m.readBy || []).filter((u) => u !== m.username);
                    const userAvatar = mine ? avatar : m.avatar || `${SERVER_URL}/uploads/default.png`;

                    return (
                      <div
                        key={m._id || i}
                        className={`message ${mine ? "me" : "other"} ${m.pending ? "pending" : ""}`}
                      >
                        {!mine && (
                          <img
                            src={userAvatar.startsWith("http") ? userAvatar : `${SERVER_URL}${userAvatar}`}
                            alt={`${m.username} avatar`}
                            className="msg-avatar"
                            onError={(e) => (e.target.src = `${SERVER_URL}/uploads/default.png`)}
                          />
                        )}
                        <div className="text">
                          {!mine && <strong>{m.username}: </strong>}
                          {m.text && <span>{m.text}</span>}

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
                              <span className="upload-label">Uploading… {m.progress}%</span>
                            </div>
                          )}

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

            {typingUser && (
              <div className={`typing-container ${!typingUser ? "hide" : ""}`}>
                <p className="typing">
                  {typingUser} is typing
                  <span className="dots"><span>.</span><span>.</span><span>.</span></span>
                </p>
              </div>
            )}

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

            <form className="composer" onSubmit={sendMessage}>
              <div className="composer-actions">
                <label className="upload-btn" title="Attach file">
                  📎
                  <input type="file" style={{ display: "none" }} onChange={(e) => handleFileUpload(e)} />
                </label>

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

              <textarea value={text} onChange={handleTyping} placeholder={`Message #${room}…`} />
              <button type="submit">Send</button>
            </form>
          </section>
        </div>
      </div>
    );
  }

  // ===== Single return with shared Profile modal =====
  return (
    <>
      {mainContent}

      {showProfile && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Profile"
          onClick={() => setShowProfile(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Edit Profile</h3>

            <div className="modal-row">
              <img
                src={avatar?.startsWith('http') ? avatar : `${SERVER_URL}${avatar || '/uploads/default.png'}`}
                alt="current avatar"
                className="modal-avatar"
                onError={(e) => (e.currentTarget.src = `${SERVER_URL}/uploads/default.png`)}
              />
              <label className="upload-btn" style={{ cursor: "pointer" }}>
                Change avatar
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => setNewAvatarFile(e.target.files?.[0] || null)}
                />
              </label>
              {newAvatarFile && <span style={{ fontSize: "0.9em" }}>{newAvatarFile.name}</span>}
            </div>

            <div className="modal-grid">
              <input
                type="password"
                placeholder="Current password (only if changing password)"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="modal-input"
              />
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="modal-input"
              />
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowProfile(false)}>Cancel</button>
              <button
                className="modal-primary"
                onClick={async () => {
                  try {
                    const fd = new FormData();
                    if (newAvatarFile) fd.append("avatar", newAvatarFile);
                    if (currentPassword || newPassword) {
                      fd.append("currentPassword", currentPassword);
                      fd.append("newPassword", newPassword);
                    }
                    const res = await axios.put(`${SERVER_URL}/me`, fd, {
                      headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
                    });
                    if (res.data?.avatar) {
                      setAvatar(res.data.avatar);
                      localStorage.setItem("chatAvatar", res.data.avatar);
                    }
                    setCurrentPassword('');
                    setNewPassword('');
                    setNewAvatarFile(null);
                    setShowProfile(false);
                    alert("Profile updated");
                  } catch (err) {
                    alert(err.response?.data?.error || "Failed to update profile");
                  }
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}











