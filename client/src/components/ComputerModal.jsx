import React, { useState, useEffect, useRef } from "react";
import { X, Monitor, MonitorUp, Loader, StopCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import socketService from "../services/socketService";
import peerService from "../services/peerService";

const ComputerModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [computerId, setComputerId] = useState(null);
    const [shareState, setShareState] = useState({
        status: 'idle', // 'idle' | 'sharing' | 'viewing'
        hostName: null,
        stream: null
    });
    const [viewerOnly, setViewerOnly] = useState(false);
    const videoRef = useRef(null);

    // Toggle body class for VideoGrid layout shifting
    useEffect(() => {
        if (isOpen) {
            document.body.classList.add("computer-modal-open");
        } else {
            document.body.classList.remove("computer-modal-open");
        }
        
        return () => {
            document.body.classList.remove("computer-modal-open");
        };
    }, [isOpen]);

    useEffect(() => {
        const handleOpen = (e) => {
            const compId = e.detail?.computerId;
            const isViewer = e.detail?.viewerOnly || false;
            setComputerId(compId);
            setViewerOnly(isViewer);
            setIsOpen(true);
            
            // Check current status of this computer
            if (compId) {
               socketService.emitCheckComputer(compId);
            }
        };

        const handleEscape = (e) => {
            if (e.key === "Escape" && isOpen) {
                handleClose();
            }
        };

        const handleForceClose = () => {
            handleClose();
        };

        const onState = (state) => {
            if (state) {
                // Someone is sharing
                if (state.socketId === socketService.socket.id) {
                     // It's us (in case we re-opened)
                     setShareState({ status: 'sharing', hostName: 'You', stream: peerService.screenStream });
                } else {
                     // Someone else
                     setShareState(prev => ({ ...prev, status: 'viewing', hostName: state.username }));
                     peerService.viewScreen(state.peerId, (stream) => {
                         setShareState(prev => ({ ...prev, stream }));
                     });
                }
            } else {
                setShareState({ status: 'idle', hostName: null, stream: null });
            }
        };

        const onStart = ({ computerId: id, state }) => {
            if (id === computerId && state.socketId !== socketService.socket.id) {
                setShareState(prev => ({ ...prev, status: 'viewing', hostName: state.username }));
                peerService.viewScreen(state.peerId, (stream) => {
                    setShareState(prev => ({ ...prev, stream }));
                });
            }
        };

        const onStop = ({ computerId: id }) => {
            if (id === computerId) {
                setShareState({ status: 'idle', hostName: null, stream: null });
                peerService.stopViewingScreen();
            }
        };

        window.addEventListener("open-computer", handleOpen);
        window.addEventListener("keydown", handleEscape);
        window.addEventListener("close-computer-force", handleForceClose);
        
        socketService.on("computerScreenState", onState);
        socketService.on("computerScreenStarted", onStart);
        socketService.on("computerScreenStopped", onStop);

        return () => {
            window.removeEventListener("open-computer", handleOpen);
            window.removeEventListener("keydown", handleEscape);
            window.removeEventListener("close-computer-force", handleForceClose);
            socketService.off("computerScreenState", onState);
            socketService.off("computerScreenStarted", onStart);
            socketService.off("computerScreenStopped", onStop);
        };
    }, [isOpen, computerId]);

    useEffect(() => {
        if (videoRef.current && shareState.stream && shareState.status === 'viewing') {
            videoRef.current.srcObject = shareState.stream;
        }
    }, [shareState.stream, shareState.status]);

    const handleClose = () => {
        if (peerService.screenStream) {
            peerService.stopScreenShare();
            socketService.emitStopComputerScreen(computerId);
            setShareState({ status: 'idle', hostName: null, stream: null });
        }
        setIsOpen(false);
        peerService.stopViewingScreen();
        window.dispatchEvent(new CustomEvent("close-computer"));
    };
    
    const handleStartShare = async () => {
        try {
           const stream = await peerService.startScreenShare();
           if (stream) {
               socketService.emitStartComputerScreen(computerId, peerService.peer.id);
               setShareState({ status: 'sharing', hostName: 'You', stream });
               
               // Listen for native user stop from browser
               stream.getVideoTracks()[0].addEventListener('ended', () => {
                   handleStopShare();
               });
           }
        } catch (err) {
           console.error("User cancelled screen share", err);
        }
    };
    
    const handleStopShare = () => {
        peerService.stopScreenShare();
        socketService.emitStopComputerScreen(computerId);
        setShareState({ status: 'idle', hostName: null, stream: null });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="w-full max-w-4xl bg-[#0e1116] border border-gray-800 rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden text-gray-100"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-[#13171f]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
                                    <Monitor size={20} />
                                </div>
                                <div>
                                    <h2 className="text-[16px] font-semibold tracking-tight text-white leading-tight">Mainframe Terminal</h2>
                                    <p className="text-xs text-gray-500">ID: {computerId || 'Unknown'}</p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4">
                                {shareState.status === 'idle' && !viewerOnly && (
                                   <button 
                                      onClick={handleStartShare}
                                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition"
                                   >
                                      <MonitorUp size={16} />
                                      Share Screen
                                   </button>
                                )}
                                {shareState.status === 'sharing' && (
                                   <button 
                                      onClick={handleStopShare}
                                      className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-900/50 hover:bg-red-600 hover:text-white rounded-lg font-medium text-sm flex items-center gap-2 transition"
                                   >
                                      <StopCircle size={16} />
                                      Stop Sharing
                                   </button>
                                )}
                                {shareState.status === 'viewing' && (
                                   <div className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-900/30 rounded-lg text-sm font-medium flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                      Viewing {shareState.hostName}'s screen
                                   </div>
                                )}
                            
                                <div className="h-6 w-px bg-gray-800 mx-1"></div>
                                <button
                                    onClick={handleClose}
                                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors border border-transparent hover:border-gray-700"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Body / Screen content */}
                        <div className="bg-[#090b0e] font-mono text-sm relative flex flex-col justify-center items-center" style={{ minHeight: '400px', maxHeight: '70vh' }}>
                            <div className="absolute inset-0 bg-blue-900/5 pointer-events-none mix-blend-screen"></div>
                            
                            {shareState.status === 'idle' && (
                                <div className="p-6 w-full h-full flex flex-col">
                                    <p className="text-green-500 mb-3 select-none">► System initialized.</p>
                                    <p className="text-gray-400 mb-3 select-none">► Connecting to secure intranet...</p>
                                    <p className="text-gray-400 mb-6 select-none">► Connection established. Welcome, User.</p>
                                    {!viewerOnly ? (
                                        <p className="text-indigo-400 mb-3 select-none block">► Click "Share Screen" to broadcast your display to this terminal.</p>
                                    ) : (
                                        <p className="text-indigo-400 mb-3 select-none block animate-pulse">► Waiting for host to broadcast display over the terminal...</p>
                                    )}
                                    
                                    <div className="animate-pulse flex items-center gap-2 text-blue-400 mt-4 select-none">
                                        <span className="w-2.5 h-5 bg-blue-500 block"></span>
                                    </div>
                                </div>
                            )}

                            {shareState.status === 'sharing' && (
                                <div className="flex flex-col items-center justify-center p-8 z-10 text-center">
                                    <div className="w-20 h-20 rounded-full bg-indigo-500/10 flex items-center justify-center mb-6">
                                        <MonitorUp size={40} className="text-indigo-400" />
                                    </div>
                                    <h3 className="text-xl font-medium text-white mb-2">You are sharing your screen</h3>
                                    <p className="text-gray-400 max-w-sm mx-auto font-sans">
                                        Anyone who interacts with this computer will be able to see your screen.
                                    </p>
                                </div>
                            )}

                            {shareState.status === 'viewing' && (
                                <div className="w-full h-full flex items-center justify-center bg-black overflow-hidden relative z-10">
                                    {!shareState.stream ? (
                                        <div className="flex flex-col items-center text-gray-400 gap-3">
                                            <Loader size={24} className="animate-spin text-indigo-500" />
                                            <span>Connecting to stream...</span>
                                        </div>
                                    ) : (
                                        <video 
                                            ref={videoRef} 
                                            autoPlay 
                                            playsInline 
                                            controls={false}
                                            className="w-full h-full object-contain"
                                        />
                                    )}
                                </div>
                            )}

                            {/* Retro Screen Glare / Scanlines */}
                            <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_4px] opacity-10 pointer-events-none z-20"></div>
                            <div className="absolute top-0 left-0 w-full h-[30%] bg-gradient-to-b from-white/2 to-transparent pointer-events-none z-20"></div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-gray-800 bg-[#13171f] flex justify-between items-center">
                            <p className="text-[13px] text-gray-500 font-medium tracking-tight">
                                Press <kbd className="px-2 py-1 bg-gray-800/80 border border-gray-700 rounded-md text-gray-300 mx-1 shadow-sm font-sans text-xs">ESC</kbd> to exit
                            </p>
                            <button
                                onClick={handleClose}
                                className="px-6 py-2.5 font-medium text-white bg-[#cc0000] rounded-xl hover:bg-[#ff1a1a] transition-all shadow-sm text-sm flex items-center gap-2"
                            >
                                Disconnect
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default ComputerModal;
