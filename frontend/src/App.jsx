import React, { useEffect, useState, useRef } from 'react'
import './App.css'

export default function App() {
  const [sessionId, setSessionId] = useState(null)
  const [model, setModel] = useState('gemini:gemini-2.5-flash')
  const [text, setText] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [showTranslations, setShowTranslations] = useState({})
  const chatRef = useRef(null)
  const [isMobile, setIsMobile] = useState(false)
  const [showSessionInfo, setShowSessionInfo] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [playingAudio, setPlayingAudio] = useState(null) // Track which message is playing audio
  const [isRecording, setIsRecording] = useState(false) // Track if voice recording is active
  const recognitionRef = useRef(null) // Store speech recognition instance

  // Session setup fields
  const [learningLanguage, setLearningLanguage] = useState('Indonesian')
  const [nativeLanguage, setNativeLanguage] = useState('English')
  const [situation, setSituation] = useState('')
  const [sessionStarted, setSessionStarted] = useState(false)
  const [loadingSuggestion, setLoadingSuggestion] = useState(false)

  // Detect if user is on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Language code mapping for Web Speech API
  const getLanguageCode = (language) => {
    const languageMap = {
      'spanish': 'es-ES',
      'french': 'fr-FR',
      'german': 'de-DE',
      'italian': 'it-IT',
      'portuguese': 'pt-PT',
      'russian': 'ru-RU',
      'japanese': 'ja-JP',
      'chinese': 'zh-CN',
      'mandarin': 'zh-CN',
      'korean': 'ko-KR',
      'arabic': 'ar-SA',
      'hindi': 'hi-IN',
      'dutch': 'nl-NL',
      'polish': 'pl-PL',
      'turkish': 'tr-TR',
      'swedish': 'sv-SE',
      'norwegian': 'no-NO',
      'danish': 'da-DK',
      'finnish': 'fi-FI',
      'greek': 'el-GR',
      'hebrew': 'he-IL',
      'thai': 'th-TH',
      'vietnamese': 'vi-VN',
      'czech': 'cs-CZ',
      'indonesian': 'id-ID',
      'malay': 'ms-MY',
      'filipino': 'fil-PH',
      'tagalog': 'fil-PH'
    }
    const normalized = language.toLowerCase().trim()
    return languageMap[normalized] || 'en-US'
  }

  // Text-to-speech function
  const speakText = (text, messageIndex) => {
    if (!text) return

    // Stop any currently playing speech
    window.speechSynthesis.cancel()

    // If clicking the same message that's playing, just stop
    if (playingAudio === messageIndex) {
      setPlayingAudio(null)
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    const langCode = getLanguageCode(learningLanguage)
    utterance.lang = langCode

    // Try to find a voice that matches the language
    const voices = window.speechSynthesis.getVoices()
    const matchingVoice = voices.find(voice => voice.lang.startsWith(langCode.substring(0, 2)))
    if (matchingVoice) {
      utterance.voice = matchingVoice
    }

    utterance.onstart = () => setPlayingAudio(messageIndex)
    utterance.onend = () => setPlayingAudio(null)
    utterance.onerror = () => setPlayingAudio(null)

    window.speechSynthesis.speak(utterance)
  }

  // Ensure voices are loaded
  useEffect(() => {
    // Web Speech API sometimes needs a moment to load voices
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices()
      }
    }
    return () => {
      // Cleanup: stop any speech when component unmounts
      window.speechSynthesis.cancel()
    }
  }, [])

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = false
      recognitionRef.current = recognition

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript
        setText(transcript)
        setIsRecording(false)
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setIsRecording(false)
      }

      recognition.onend = () => {
        setIsRecording(false)
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  // Update recognition language when learning language changes
  useEffect(() => {
    if (recognitionRef.current && learningLanguage) {
      const langCode = getLanguageCode(learningLanguage)
      recognitionRef.current.lang = langCode
    }
  }, [learningLanguage])

  // Toggle voice recording
  const toggleVoiceRecording = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.')
      return
    }

    if (isRecording) {
      recognitionRef.current.stop()
      setIsRecording(false)
    } else {
      setText('') // Clear input when starting recording
      recognitionRef.current.start()
      setIsRecording(true)
    }
  }

  useEffect(() => {
    // Generate a situation suggestion on load
    const getSuggestion = async () => {
      setLoadingSuggestion(true)
      try {
        const resp = await fetch('/api/suggest-situation', { method: 'POST' })
        const data = await resp.json()
        setSituation(data.suggestion || '')
      } catch (err) {
        console.error('Failed to get suggestion:', err)
        setSituation('Ordering food at a restaurant')
      } finally {
        setLoadingSuggestion(false)
      }
    }
    getSuggestion()
  }, [])

  async function startSession() {
    setSessionError('')
    if (!learningLanguage || !nativeLanguage || !situation.trim()) {
      setSessionError('All fields are required.')
      return
    }
    try {
      const resp = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learning_language: learningLanguage,
          native_language: nativeLanguage,
            situation: situation,
          model: model
        })
      })
      if (!resp.ok) {
        const text = await resp.text()
        setSessionError(`Failed to start session (${resp.status}). ${text.substring(0,120)}`)
        return
      }
      const data = await resp.json()
      if (!data.session_id) {
        setSessionError('Backend returned no session id.')
        return
      }
      setSessionId(data.session_id)
      if (data.initial_message) {
        const initial = { role: 'assistant', reply: data.initial_message, translation: data.initial_translation || '', feedback: '', status: 'done' }
        setMessages([initial])
      }
      setSessionStarted(true)
    } catch (e) {
      setSessionError(`Network error starting session: ${e.message}`)
    }
  }

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  async function send() {
    if (!text.trim() || loading) return
    if (!sessionId) return alert('no session yet')

    const userMessage = text.trim()
    setText('')
    setLoading(true)

    // Add user's message locally
    setMessages(prev => [...prev, { role: 'user', text: userMessage }])

    // Prepare message object for assistant response
    const assistantMessage = {
      role: 'assistant',
      reply: '',
      translation: '',
      feedback: '',
      status: 'loading'
    }
    setMessages(prev => [...prev, assistantMessage])

    try {
      const resp = await fetch('/api/message', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ session_id: sessionId, text: userMessage, model }) 
      })

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            
            if (data.type === 'reply') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].reply = data.text
                return updated
              })
            } else if (data.type === 'translation') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].translation = data.text
                return updated
              })
            } else if (data.type === 'feedback') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].feedback = data.text
                return updated
              })
            } else if (data.type === 'done') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].status = 'done'
                return updated
              })
              // Auto-play audio for the completed bot message
              setMessages(prev => {
                const lastMessage = prev[prev.length - 1]
                if (lastMessage && lastMessage.reply) {
                  // Small delay to ensure state is updated
                  setTimeout(() => speakText(lastMessage.reply, prev.length - 1), 300)
                }
                return prev
              })
            } else if (data.type === 'error') {
              console.error('Stream error:', data.message)
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].status = 'error'
                updated[updated.length - 1].error = data.message
                return updated
              })
            }
          } catch (e) {
            console.warn('Failed to parse line:', line, e)
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer)
          if (data.type === 'reply') {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1].reply = data.text
              return updated
            })
          }
        } catch (e) { }
      }

    } catch (err) {
      console.error('Failed to send message:', err)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1].status = 'error'
        updated[updated.length - 1].error = 'Failed to send message'
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ 
      padding: '12px', 
      maxWidth: '100%', 
      margin: '0 auto', 
      boxSizing: 'border-box',
      background: 'linear-gradient(135deg, #4a5fd6 0%, #5a3482 100%)',
      minHeight: '100vh'
    }}>
      <div style={{ 
        background: 'white', 
        borderRadius: 12, 
        padding: '16px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{ 
          fontSize: '1.5rem', 
          margin: '0 0 16px 0',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          🌍 Language Roleplay
        </h2>

      {!sessionStarted ? (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: '1.2rem', color: '#333', marginBottom: 12 }}>🚀 Start a new session</h3>
          {sessionError && (
            <div style={{ 
              marginBottom: 12,
              padding: '10px 12px',
              background: '#ffebee',
              border: '1px solid #ffcdd2',
              color: '#c62828',
              borderRadius: 8,
              fontSize: '0.85rem',
              lineHeight: 1.4
            }}>
              ⚠️ {sessionError}
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: '500', color: '#555' }}>🎓 Language you're learning:</label>
            <input 
              value={learningLanguage} 
              onChange={e => setLearningLanguage(e.target.value)} 
              placeholder="e.g. Spanish" 
              style={{ 
                width: '100%', 
                padding: 10, 
                boxSizing: 'border-box',
                border: '2px solid #e0e0e0',
                borderRadius: 8,
                fontSize: '1rem',
                transition: 'border-color 0.3s'
              }} 
              onFocus={e => e.target.style.borderColor = '#667eea'}
              onBlur={e => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: '500', color: '#555' }}>🏠 Your native language:</label>
            <input 
              value={nativeLanguage} 
              onChange={e => setNativeLanguage(e.target.value)} 
              placeholder="e.g. English" 
              style={{ 
                width: '100%', 
                padding: 10, 
                boxSizing: 'border-box',
                border: '2px solid #e0e0e0',
                borderRadius: 8,
                fontSize: '1rem',
                transition: 'border-color 0.3s'
              }}
              onFocus={e => e.target.style.borderColor = '#667eea'}
              onBlur={e => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: '500', color: '#555' }}>🤖 Model:</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                boxSizing: 'border-box',
                border: '2px solid #e0e0e0',
                borderRadius: 8,
                fontSize: '1rem',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              <optgroup label="Ollama (Local)">
                <option value="qwen2.5:7b-instruct">Qwen2.5 7B Instruct</option>
                <option value="llama3">Llama 3</option>
                <option value="llama3.2">Llama 3.2</option>
                <option value="mistral">Mistral</option>
                <option value="gemma2">Gemma 2</option>
                <option value="gemma3">Gemma 3</option>
                <option value="mistral-nemo">Mistral Nemo</option>
              </optgroup>
              <optgroup label="Gemini Stable">
                <option value="gemini:gemini-flash-latest">Gemini Flash Latest</option>
                <option value="gemini:gemini-pro-latest">Gemini Pro Latest</option>
                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
              </optgroup>
              <optgroup label="Gemini 2.5 Previews">
                <option value="gemini:gemini-2.5-pro-preview-06-05">2.5 Pro Preview (06-05)</option>
                <option value="gemini:gemini-2.5-pro-preview-05-06">2.5 Pro Preview (05-06)</option>
                <option value="gemini:gemini-2.5-pro-preview-03-25">2.5 Pro Preview (03-25)</option>
                <option value="gemini:gemini-2.5-flash">2.5 Flash (base)</option>
                <option value="gemini:gemini-2.5-flash-lite">2.5 Flash Lite</option>
              </optgroup>
              <optgroup label="Gemini 3 Preview">
                <option value="gemini:gemini-3-pro-preview">3 Pro Preview</option>
              </optgroup>
              <optgroup label="Experimental (Use Caution)">
                <option value="gemini:gemini-2.0-flash">2.0 Flash</option>
                <option value="gemini:gemini-2.0-pro-exp">2.0 Pro Exp</option>
                <option value="gemini:gemini-2.0-flash-thinking-exp">2.0 Flash Thinking Exp</option>
                <option value="gemini:gemini-2.0-flash-lite">2.0 Flash Lite</option>
              </optgroup>
            </select>
            <div style={{ marginTop: 6, fontSize: '0.65rem', color: '#777', lineHeight: 1.2 }}>
              Preview / experimental models may be quota-limited or change output quality.
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: '500', color: '#555' }}>🎭 Describe the situation:</label>
            <textarea 
              value={situation} 
              onChange={e => setSituation(e.target.value)} 
              placeholder={loadingSuggestion ? "Loading suggestion..." : "e.g. Ordering food at a restaurant"} 
              style={{ 
                width: '100%', 
                height: 80, 
                padding: 10, 
                boxSizing: 'border-box',
                border: '2px solid #e0e0e0',
                borderRadius: 8,
                fontSize: '1rem',
                resize: 'vertical',
                fontFamily: 'inherit',
                transition: 'border-color 0.3s'
              }}
              disabled={loadingSuggestion}
              onFocus={e => e.target.style.borderColor = '#667eea'}
              onBlur={e => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
          <button 
            onClick={startSession} 
            style={{ 
              width: '100%', 
              padding: 14, 
              fontSize: '1.1rem',
              fontWeight: 'bold',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 4px 6px rgba(102, 126, 234, 0.3)',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}
            onMouseOver={e => {
              e.target.style.transform = 'translateY(-2px)'
              e.target.style.boxShadow = '0 6px 12px rgba(102, 126, 234, 0.4)'
            }}
            onMouseOut={e => {
              e.target.style.transform = 'translateY(0)'
              e.target.style.boxShadow = '0 4px 6px rgba(102, 126, 234, 0.3)'
            }}
          >
            ✨ Start Roleplay
          </button>
        </div>
      ) : (
        <>
          {isMobile ? (
            /* Mobile: Compact stacked layout */
            <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
              {/* Chat area with input - takes upper portion */}
              <div style={{ 
                flex: '0 0 45%', 
                display: 'flex',
                flexDirection: 'column',
                border: 'none',
                borderRadius: '12px 12px 0 0',
                overflow: 'hidden'
              }}>
                <div id="chat" ref={chatRef} style={{ 
                  flex: 1,
                  padding: 8, 
                  overflowY: 'auto', 
                  background: '#e8eaf0', 
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                }}>
                {messages.map((m, i) => (
                  <div key={i} style={{ margin: '8px 0' }}>
                    {m.role === 'user' ? (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ 
                          display: 'inline-block', 
                          padding: '8px 12px', 
                          borderRadius: 16, 
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                          color: 'white', 
                          maxWidth: '85%', 
                          wordWrap: 'break-word', 
                          fontSize: '0.9rem',
                          boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
                        }}>{m.text}</div>
                      </div>
                    ) : (
                      <div style={{ maxWidth: '85%' }}>
                        {m.reply && (
                          <div style={{ 
                            padding: 10, 
                            background: 'white', 
                            borderRadius: 16, 
                            boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                            border: '1px solid #e8e8e8'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              <div style={{ flex: 1, wordWrap: 'break-word', fontSize: '0.9rem', lineHeight: 1.5 }}>{m.reply}</div>
                              <button
                                onClick={() => speakText(m.reply, i)}
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '1rem',
                                  background: playingAudio === i ? '#ff5722' : '#2196F3',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: 12,
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  boxShadow: '0 2px 4px rgba(33, 150, 243, 0.3)',
                                  transition: 'all 0.2s'
                                }}
                                title={playingAudio === i ? 'Stop audio' : 'Play audio'}
                              >
                                {playingAudio === i ? '⏸' : '🔊'}
                              </button>
                            </div>
                            {m.translation && (
                              <button 
                                onClick={() => setShowTranslations(prev => ({ ...prev, [i]: !prev[i] }))}
                                style={{ 
                                  marginTop: 8, 
                                  padding: '5px 10px', 
                                  fontSize: '0.75rem', 
                                  background: '#4CAF50', 
                                  color: 'white', 
                                  border: 'none', 
                                  borderRadius: 12, 
                                  cursor: 'pointer',
                                  fontWeight: '500',
                                  boxShadow: '0 2px 4px rgba(76, 175, 80, 0.3)'
                                }}
                              >
                                {showTranslations[i] ? '🔼' : '🔽'} Translation
                              </button>
                            )}
                            {showTranslations[i] && m.translation && (
                              <div style={{ 
                                marginTop: 8, 
                                padding: 8, 
                                background: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)', 
                                borderRadius: 12, 
                                fontSize: '0.85rem',
                                lineHeight: 1.4
                              }}>
                                {m.translation}
                              </div>
                            )}
                          </div>
                        )}
                        {m.status === 'loading' && !m.reply && (
                          <div style={{ 
                            fontStyle: 'italic', 
                            color: '#999', 
                            padding: 8, 
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                          }}>
                            <span style={{ 
                              width: 16, 
                              height: 16, 
                              border: '2px solid #ddd',
                              borderTop: '2px solid #667eea',
                              borderRadius: '50%',
                              display: 'inline-block',
                              animation: 'spin 1s linear infinite'
                            }}></span>
                            Generating...
                          </div>
                        )}
                        {m.status === 'error' && (
                          <div style={{ 
                            color: '#d32f2f', 
                            padding: 8, 
                            fontSize: '0.85rem',
                            background: '#ffebee',
                            borderRadius: 12,
                            border: '1px solid #ffcdd2'
                          }}>⚠️ Error: {m.error}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Input area - right after chat */}
              <div style={{ 
                flex: '0 0 auto', 
                display: 'flex', 
                gap: 8, 
                padding: 8, 
                background: 'white', 
                borderTop: 'none',
                boxShadow: '0 -2px 4px rgba(0,0,0,0.06)'
              }}>
                <input 
                  value={text} 
                  onChange={e => setText(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && send()} 
                  placeholder={isRecording ? 'Listening...' : 'Type your message...'} 
                  disabled={loading || isRecording} 
                  style={{ 
                    flex: 1, 
                    padding: 10, 
                    fontSize: '0.95rem', 
                    border: `2px solid ${isRecording ? '#ff5722' : '#e8e8e8'}`, 
                    borderRadius: 20,
                    outline: 'none',
                    transition: 'all 0.2s ease',
                    background: isRecording ? '#ffebee' : 'white'
                  }}
                  onFocus={(e) => !isRecording && (e.target.style.borderColor = '#667eea')}
                  onBlur={(e) => !isRecording && (e.target.style.borderColor = '#e8e8e8')}
                />
                <button 
                  onClick={toggleVoiceRecording} 
                  disabled={loading}
                  style={{ 
                    padding: '10px 16px', 
                    fontSize: '1.1rem', 
                    cursor: loading ? 'not-allowed' : 'pointer', 
                    background: isRecording ? '#ff5722' : '#4CAF50',
                    color: 'white', 
                    border: 'none', 
                    borderRadius: 20,
                    fontWeight: 'bold',
                    boxShadow: '0 4px 8px rgba(76, 175, 80, 0.3)',
                    transition: 'all 0.2s ease',
                    minWidth: 50,
                    animation: isRecording ? 'pulse 1.5s infinite' : 'none'
                  }}
                  title={isRecording ? 'Stop recording' : 'Start voice input'}
                >
                  {isRecording ? '⏹' : '🎤'}
                </button>
                <button 
                  onClick={send} 
                  disabled={loading} 
                  style={{ 
                    padding: '10px 20px', 
                    fontSize: '1rem', 
                    cursor: loading ? 'not-allowed' : 'pointer', 
                    background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: 20,
                    fontWeight: 'bold',
                    boxShadow: loading ? 'none' : '0 4px 8px rgba(102, 126, 234, 0.3)',
                    transition: 'all 0.2s ease',
                    minWidth: 70
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) {
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 6px 12px rgba(102, 126, 234, 0.4)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) {
                      e.target.style.transform = 'translateY(0)';
                      e.target.style.boxShadow = '0 4px 8px rgba(102, 126, 234, 0.3)';
                    }
                  }}
                >
                  {loading ? '⏳' : '➤'}
                </button>
              </div>
            </div>

              {/* Feedback area - compact at bottom */}
              <div style={{ 
                flex: '0 0 20%', 
                border: 'none', 
                padding: 8, 
                background: 'linear-gradient(135deg, #fff3c4 0%, #ffdb5c 100%)', 
                overflowY: 'auto',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
                borderRadius: '0 0 12px 12px'
              }}>
                <h4 style={{ 
                  margin: '0 0 8px 0', 
                  fontSize: '0.9rem', 
                  color: '#F57C00',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}>📝 Feedback</h4>
                {messages.filter(m => m.role === 'assistant' && m.feedback).length === 0 ? (
                  <div style={{ 
                    color: '#999', 
                    fontStyle: 'italic', 
                    fontSize: '0.8rem', 
                    textAlign: 'center',
                    padding: 20
                  }}>💬 Feedback will appear here...</div>
                ) : (
                  messages.map((m, i) => {
                    if (m.role === 'assistant' && m.feedback) {
                      const userMsg = messages[i - 1]
                      return (
                        <div key={i} style={{ 
                          marginBottom: 8, 
                          padding: 10, 
                          background: 'rgba(255,255,255,0.6)', 
                          borderRadius: 12, 
                          fontSize: '0.8rem',
                          border: '1px solid rgba(245, 124, 0, 0.2)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                        }}>
                          <div style={{ 
                            color: '#999', 
                            marginBottom: 4, 
                            fontStyle: 'italic', 
                            fontSize: '0.75rem',
                            borderLeft: '2px solid #667eea',
                            paddingLeft: 6
                          }}>
                            "{userMsg?.text?.substring(0, 30)}{userMsg?.text?.length > 30 ? '...' : ''}"
                          </div>
                          <div style={{ 
                            color: '#5d4037',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap'
                          }}>{m.feedback}</div>
                        </div>
                      )
                    }
                    return null
                  })
                )}
              </div>

              {/* Session info toggle at bottom */}
              <button 
                onClick={() => setShowSessionInfo(!showSessionInfo)}
                style={{ 
                  marginTop: 8,
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 3px 6px rgba(102, 126, 234, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 2px 4px rgba(102, 126, 234, 0.3)';
                }}
              >
                {showSessionInfo ? '▲' : '▼'} Session Info
              </button>
              {showSessionInfo && (
                <div style={{ 
                  marginTop: 4, 
                  padding: 12, 
                  background: 'rgba(255,255,255,0.9)', 
                  borderRadius: 12, 
                  fontSize: '0.75rem',
                  border: '1px solid #e8e8e8',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}>
                  <div style={{ marginBottom: 4 }}><strong>🎓 Learning:</strong> {learningLanguage}</div>
                  <div style={{ marginBottom: 4 }}><strong>🏠 Native:</strong> {nativeLanguage}</div>
                  <div style={{ marginBottom: 4 }}><strong>🎭 Situation:</strong> {situation}</div>
                  <div><strong>🤖 Model:</strong> {model}</div>
                </div>
              )}
            </div>
          ) : (
            /* Desktop: Side-by-side layout */
            <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
              {/* Session info toggle */}
              <button 
                onClick={() => setShowSessionInfo(!showSessionInfo)}
                style={{ 
                  marginBottom: 12,
                  padding: '8px 12px',
                  fontSize: '0.85rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 20,
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 3px 6px rgba(102, 126, 234, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 2px 4px rgba(102, 126, 234, 0.3)';
                }}
              >
                {showSessionInfo ? '▲' : '▼'} Session Info
              </button>
              {showSessionInfo && (
                <div style={{ 
                  marginBottom: 12, 
                  padding: 12, 
                  background: 'rgba(255,255,255,0.9)', 
                  borderRadius: 12, 
                  fontSize: '0.85rem',
                  border: '1px solid #e8e8e8',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}>
                  <div style={{ marginBottom: 4 }}><strong>🎓 Learning:</strong> {learningLanguage}</div>
                  <div style={{ marginBottom: 4 }}><strong>🏠 Native:</strong> {nativeLanguage}</div>
                  <div style={{ marginBottom: 4 }}><strong>🎭 Situation:</strong> {situation}</div>
                  <div><strong>🤖 Model:</strong> {model}</div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
                {/* Main chat area */}
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div id="chat" ref={chatRef} style={{ 
                    flex: 1, 
                    border: 'none', 
                    padding: 12, 
                    overflowY: 'auto', 
                    background: '#e8eaf0', 
                    marginBottom: 12, 
                    borderRadius: 12,
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    {messages.map((m, i) => (
                      <div key={i} style={{ margin: '12px 0' }}>
                        {m.role === 'user' ? (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ 
                              display: 'inline-block', 
                              padding: '10px 14px', 
                              borderRadius: 16, 
                              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                              color: 'white', 
                              maxWidth: '70%', 
                              wordWrap: 'break-word',
                              boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
                            }}>{m.text}</div>
                          </div>
                        ) : (
                          <div style={{ maxWidth: '70%' }}>
                            {m.reply && (
                              <div style={{ 
                                padding: 12, 
                                background: 'white', 
                                borderRadius: 16, 
                                boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                                border: '1px solid #e8e8e8'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                  <div style={{ flex: 1, wordWrap: 'break-word', lineHeight: 1.5 }}>{m.reply}</div>
                                  <button
                                    onClick={() => speakText(m.reply, i)}
                                    style={{
                                      padding: '8px 12px',
                                      fontSize: '1.1rem',
                                      background: playingAudio === i ? '#ff5722' : '#2196F3',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: 12,
                                      cursor: 'pointer',
                                      flexShrink: 0,
                                      boxShadow: '0 2px 4px rgba(33, 150, 243, 0.3)',
                                      transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.target.style.transform = 'scale(1.05)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.target.style.transform = 'scale(1)';
                                    }}
                                    title={playingAudio === i ? 'Stop audio' : 'Play audio'}
                                  >
                                    {playingAudio === i ? '⏸' : '🔊'}
                                  </button>
                                </div>
                                {m.translation && (
                                  <button 
                                    onClick={() => setShowTranslations(prev => ({ ...prev, [i]: !prev[i] }))}
                                    style={{ 
                                      marginTop: 10, 
                                      padding: '6px 12px', 
                                      fontSize: '0.85rem', 
                                      background: '#4CAF50', 
                                      color: 'white', 
                                      border: 'none', 
                                      borderRadius: 12, 
                                      cursor: 'pointer',
                                      fontWeight: '500',
                                      boxShadow: '0 2px 4px rgba(76, 175, 80, 0.3)'
                                    }}
                                  >
                                    {showTranslations[i] ? '🔼' : '🔽'} Translation
                                  </button>
                                )}
                                {showTranslations[i] && m.translation && (
                                  <div style={{ 
                                    marginTop: 10, 
                                    padding: 10, 
                                    background: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)', 
                                    borderRadius: 12, 
                                    fontSize: '0.9rem',
                                    lineHeight: 1.4
                                  }}>
                                    {m.translation}
                                  </div>
                                )}
                              </div>
                            )}
                            {m.status === 'loading' && !m.reply && (
                              <div style={{ 
                                fontStyle: 'italic', 
                                color: '#999', 
                                padding: 10,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8
                              }}>
                                <span style={{ 
                                  width: 18, 
                                  height: 18, 
                                  border: '2px solid #ddd',
                                  borderTop: '2px solid #667eea',
                                  borderRadius: '50%',
                                  display: 'inline-block',
                                  animation: 'spin 1s linear infinite'
                                }}></span>
                                Generating...
                              </div>
                            )}
                            {m.status === 'error' && (
                              <div style={{ 
                                color: '#d32f2f', 
                                padding: 10,
                                background: '#ffebee',
                                borderRadius: 12,
                                border: '1px solid #ffcdd2'
                              }}>⚠️ Error: {m.error}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ 
                    display: 'flex', 
                    gap: 10, 
                    alignItems: 'center',
                    padding: 8,
                    background: 'white',
                    borderRadius: 12,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.06)'
                  }}>
                    <input 
                      value={text} 
                      onChange={e => setText(e.target.value)} 
                      onKeyDown={e => e.key === 'Enter' && send()} 
                      placeholder={isRecording ? 'Listening...' : 'Type your message...'} 
                      disabled={loading || isRecording} 
                      style={{ 
                        flex: 1, 
                        padding: 10,
                        border: `2px solid ${isRecording ? '#ff5722' : '#e8e8e8'}`,
                        borderRadius: 20,
                        outline: 'none',
                        fontSize: '0.95rem',
                        transition: 'all 0.2s ease',
                        background: isRecording ? '#ffebee' : 'white'
                      }}
                      onFocus={(e) => !isRecording && (e.target.style.borderColor = '#667eea')}
                      onBlur={(e) => !isRecording && (e.target.style.borderColor = '#e8e8e8')}
                    />
                    <button 
                      onClick={toggleVoiceRecording} 
                      disabled={loading}
                      style={{ 
                        padding: '10px 18px', 
                        fontSize: '1.2rem', 
                        cursor: loading ? 'not-allowed' : 'pointer', 
                        background: isRecording ? '#ff5722' : '#4CAF50',
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 20,
                        fontWeight: 'bold',
                        boxShadow: '0 4px 8px rgba(76, 175, 80, 0.3)',
                        transition: 'all 0.2s ease',
                        minWidth: 60,
                        animation: isRecording ? 'pulse 1.5s infinite' : 'none'
                      }}
                      onMouseEnter={(e) => {
                        if (!loading) {
                          e.target.style.transform = 'translateY(-2px)';
                          e.target.style.boxShadow = '0 6px 12px rgba(76, 175, 80, 0.4)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!loading) {
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = '0 4px 8px rgba(76, 175, 80, 0.3)';
                        }
                      }}
                      title={isRecording ? 'Stop recording' : 'Start voice input'}
                    >
                      {isRecording ? '⏹' : '🎤'}
                    </button>
                    <button 
                      onClick={send} 
                      disabled={loading} 
                      style={{ 
                        padding: '10px 20px', 
                        cursor: loading ? 'not-allowed' : 'pointer',
                        background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 20,
                        fontWeight: 'bold',
                        fontSize: '1rem',
                        boxShadow: loading ? 'none' : '0 4px 8px rgba(102, 126, 234, 0.3)',
                        transition: 'all 0.2s ease',
                        minWidth: 80
                      }}
                      onMouseEnter={(e) => {
                        if (!loading) {
                          e.target.style.transform = 'translateY(-2px)';
                          e.target.style.boxShadow = '0 6px 12px rgba(102, 126, 234, 0.4)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!loading) {
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = '0 4px 8px rgba(102, 126, 234, 0.3)';
                        }
                      }}
                    >
                      {loading ? '⏳' : '➤'}
                    </button>
                  </div>
                </div>

                {/* Feedback sidebar */}
                <div style={{ 
                  flex: 1, 
                  border: 'none', 
                  borderRadius: 12, 
                  padding: 16, 
                  background: 'linear-gradient(135deg, #fff3c4 0%, #ffdb5c 100%)', 
                  overflowY: 'auto',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                }}>
                  <h3 style={{ 
                    margin: '0 0 12px 0', 
                    fontSize: '1.1rem', 
                    color: '#F57C00',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>📝 Feedback</h3>
                  {messages.filter(m => m.role === 'assistant' && m.feedback).length === 0 ? (
                    <div style={{ 
                      color: '#999', 
                      fontStyle: 'italic',
                      textAlign: 'center',
                      padding: 20
                    }}>💬 Feedback will appear here...</div>
                  ) : (
                    messages.map((m, i) => {
                      if (m.role === 'assistant' && m.feedback) {
                        const userMsg = messages[i - 1]
                        return (
                          <div key={i} style={{ 
                            marginBottom: 12, 
                            padding: 12, 
                            background: 'rgba(255,255,255,0.7)', 
                            borderRadius: 12, 
                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                            border: '1px solid rgba(245, 124, 0, 0.2)'
                          }}>
                            <div style={{ 
                              fontSize: '0.85rem', 
                              color: '#999', 
                              marginBottom: 6, 
                              fontStyle: 'italic',
                              borderLeft: '2px solid #667eea',
                              paddingLeft: 8
                            }}>
                              "{userMsg?.text?.substring(0, 40)}{userMsg?.text?.length > 40 ? '...' : ''}"
                            </div>
                            <div style={{ 
                              fontSize: '0.95rem',
                              color: '#5d4037',
                              lineHeight: 1.5
                            }}>{m.feedback}</div>
                          </div>
                        )
                      }
                      return null
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  )
}
