import React, { useState, useEffect } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { api } from './api';
import { useToast } from './toasts';
import { fmtDateTime } from './utils';

export default function CommentThread({ requestId }) {
  const { push } = useToast();
  const [comments, setComments] = useState([]);
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const [open, setOpen]         = useState(false);

  const load = async () => {
    try {
      const data = await api.getRequestComments(requestId);
      setComments(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => { if (open) load(); }, [open, requestId]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.addRequestComment(requestId, text.trim());
      setText('');
      load();
    } catch (e) {
      push(e.message || 'Failed to send comment', 'error');
    } finally { setSending(false); }
  };

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 font-medium"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {open ? 'Hide' : 'Show'} Comments
        {comments.length > 0 && !open && (
          <span className="ml-1 h-4 w-4 flex items-center justify-center rounded-full bg-sky-500 text-white text-[10px] font-bold">
            {comments.length}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {comments.length === 0 ? (
            <p className="text-xs text-neutral-400 italic">No comments yet. Add one below.</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {comments.map(c => {
                const isAdmin = ['admin', 'administrator', 'superadmin', 'hq_admin'].includes(
                  (c.author_role || c.user_role || '').toLowerCase()
                );
                return (
                  <div key={c.id} className={`rounded-xl px-3 py-2 text-xs ${
                    isAdmin ? 'bg-emerald-50 border border-emerald-100' : 'bg-sky-50 border border-sky-100'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-semibold text-neutral-800">
                        {c.author || c.user_name || 'Unknown'}
                      </span>
                      {isAdmin && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded-full">Admin</span>
                      )}
                      <span className="text-neutral-400 ml-auto">
                        {c.created_at ? fmtDateTime(c.created_at) : ''}
                      </span>
                    </div>
                    <p className="text-neutral-700">{c.message}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Add a comment…"
              className="flex-1 text-xs border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-emerald-400"
            />
            <button
              onClick={send} disabled={sending || !text.trim()}
              className="flex items-center gap-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl disabled:opacity-50 transition"
            >
              <Send className="h-3 w-3" />{sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
