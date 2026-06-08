// frontend/src/DeliveryNotifier.jsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Bell, X, CheckCircle, Package, Download, Eye } from 'lucide-react';
import { api } from './api';
import { useToast } from './toasts';

// Individual Notification Component
function NotificationItem({ notification, onMarkRead, onView, onDownload }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getIcon = () => {
    switch (notification.type) {
      case 'delivery_confirmed':
        return <Package className="h-5 w-5 text-green-500" />;
      default:
        return <Bell className="h-5 w-5 text-blue-500" />;
    }
  };
  
  const getTimeAgo = (timestamp) => {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    if (seconds < 60) return `${seconds} seconds ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };
  
  return (
    <div 
      className={`border-b border-neutral-200 dark:border-neutral-700 last:border-0 transition-all ${
        !notification.is_read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
      }`}
    >
      <div className="p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition cursor-pointer">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            {getIcon()}
          </div>
          
          <div className="flex-1 min-w-0" onClick={() => setIsExpanded(!isExpanded)}>
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {notification.title}
              </h4>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {getTimeAgo(notification.timestamp)}
              </span>
            </div>
            
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {notification.message}
            </p>
            
            {isExpanded && notification.type === 'delivery_confirmed' && (
              <div className="mt-3 p-3 bg-neutral-100 dark:bg-neutral-700 rounded-lg space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Tool:</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{notification.tool_name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Quantity:</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{notification.quantity}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Facility:</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{notification.facility}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Confirmed by:</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{notification.requester}</p>
                  </div>
                </div>
                
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(notification.request_id);
                    }}
                    className="flex-1 px-3 py-1.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                  >
                    <Eye className="h-3 w-3 inline mr-1" />
                    View Request
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(notification.delivery_id);
                    }}
                    className="flex-1 px-3 py-1.5 text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-800 transition"
                  >
                    <Download className="h-3 w-3 inline mr-1" />
                    Download Note
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(notification.id);
            }}
            className="flex-shrink-0 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Main Delivery Notifier Component
export default function DeliveryNotifier() {
  const { push } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const eventSourceRef = useRef(null);
  
  // Determine if current user is admin
  const userRole = localStorage.getItem('user_role');
  const isAdmin = userRole === 'admin';
  
  // Load recent notifications on mount (all users)
  useEffect(() => {
    loadRecentNotifications();
    
    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);
  
  // Connect to SSE stream when admin is logged in and notifier is mounted
  useEffect(() => {
    if (isAdmin) {
      connectToNotificationStream();
    }
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);
  
  const loadRecentNotifications = async () => {
    try {
      const recent = await api.getRecentNotifications();
      setNotifications(recent);
      updateUnreadCount(recent);
    } catch (error) {
      console.error('Failed to load recent notifications:', error);
    }
  };
  
  const connectToNotificationStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    setIsConnecting(true);
    
    try {
      const eventSource = new EventSource('/api/notifications/stream', {
        withCredentials: true
      });
      
      eventSource.onopen = () => {
        console.log('Notification stream connected');
        setIsConnecting(false);
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'delivery_confirmed') {
            // Add new notification to the list
            const newNotification = {
              id: Date.now(),
              ...data,
              is_read: false
            };
            
            setNotifications(prev => [newNotification, ...prev]);
            setUnreadCount(prev => prev + 1);
            
            // Show toast notification
            push(
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>{data.message}</span>
              </div>,
              'info',
              5000
            );
            
            // Play notification sound (optional)
            playNotificationSound();
          }
        } catch (error) {
          console.error('Error parsing notification:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('Notification stream error:', error);
        eventSource.close();
        setIsConnecting(false);
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          connectToNotificationStream();
        }, 5000);
      };
      
      eventSourceRef.current = eventSource;
    } catch (error) {
      console.error('Failed to connect to notification stream:', error);
      setIsConnecting(false);
    }
  };
  
  const playNotificationSound = () => {
    try {
      const audio = new Audio('/notification.mp3');
      audio.play().catch(e => console.log('Audio play failed:', e));
    } catch (error) {
      // Silently fail if audio not available
    }
  };
  
  const updateUnreadCount = (notifs) => {
    const count = notifs.filter(n => !n.is_read).length;
    setUnreadCount(count);
  };
  
  const markAsRead = async (notificationId) => {
    try { await api.markNotificationRead(notificationId); } catch {}
    setNotifications(prev => 
      prev.map(n => 
        n.id === notificationId ? { ...n, is_read: true } : n
      )
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };
  
  const markAllAsRead = async () => {
    try { await api.markAllNotificationsRead(); } catch {}
    setNotifications(prev => 
      prev.map(n => ({ ...n, is_read: true }))
    );
    setUnreadCount(0);
    push('All notifications marked as read', 'success');
  };
  
  const viewRequest = (requestId) => {
    // Navigate to the request in admin panel
    // You'll need to implement this based on your routing
    window.location.href = `/admin?request_id=${requestId}`;
    setIsOpen(false);
  };
  
  const downloadDeliveryNote = async (deliveryId) => {
    try {
      const blob = await api.downloadDeliveryNote(deliveryId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `delivery_note_${deliveryId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      push('Delivery note downloaded successfully', 'success');
    } catch (error) {
      push('Failed to download delivery note', 'error');
    }
  };
  
  const clearAllNotifications = () => {
    if (confirm('Clear all notifications? This cannot be undone.')) {
      setNotifications([]);
      setUnreadCount(0);
      push('All notifications cleared', 'success');
    }
  };
  
  return (
    <div className="relative">
      {/* Notification Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
      >
        <Bell className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {isConnecting && (
          <span className="absolute bottom-0 right-0 h-2 w-2 bg-yellow-500 rounded-full animate-pulse"></span>
        )}
      </button>
      
      {/* Notifications Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown Panel */}
          <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 z-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-950/30 dark:to-neutral-900">
              <div>
                <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Notifications
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Real-time delivery updates
                </p>
              </div>
              <div className="flex gap-2">
                {notifications.length > 0 && (
                  <>
                    <button
                      onClick={markAllAsRead}
                      className="text-xs px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
                    >
                      Mark all read
                    </button>
                    <button
                      onClick={clearAllNotifications}
                      className="text-xs px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>
            </div>
            
            {/* Notifications List */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="h-12 w-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No notifications yet
                  </p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                    When facility users confirm deliveries, you'll see them here
                  </p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkRead={markAsRead}
                    onView={viewRequest}
                    onDownload={downloadDeliveryNote}
                  />
                ))
              )}
            </div>
            
            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-700 text-center">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  🔔 Real-time notifications active
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}