import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import type { WindowGesture } from '../types';

const directions: WindowGesture[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
export function ResizeFrame() {
  const active = useRef<{ pointer: number; target: HTMLDivElement; ready: Promise<unknown> } | null>(null);
  const frame = useRef(0);
  const sequence = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState('');
  const [resizing, setResizing] = useState(false);
  function finish() {
    const gesture = active.current;
    if (!gesture) return;
    active.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (gesture.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer);
    setResizing(false);
    sequence.current = sequence.current.catch(() => {}).then(async () => {
      try { await api.updateWindowGesture?.(); } finally { await api.endWindowGesture?.(); }
    }).catch(() => {});
  }
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => { window.removeEventListener('blur', finish); finish(); };
  }, []);
  if (!window.quota?.beginWindowGesture) return null;
  function begin(event: PointerEvent<HTMLDivElement>, direction: WindowGesture) {
    if (event.button !== 0 || active.current) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setResizing(true); setError('');
    const ready = sequence.current.catch(() => {}).then(() => api.beginWindowGesture!(direction));
    sequence.current = ready;
    active.current = { pointer: event.pointerId, target, ready };
    void ready.catch(() => { setError('缩放暂不可用，请重试'); finish(); });
  }
  function move() {
    const gesture = active.current;
    if (!gesture || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      sequence.current = sequence.current.catch(() => {}).then(() => active.current === gesture ? api.updateWindowGesture?.() : undefined).catch(finish);
    });
  }
  return <><div className={`resize-frame ${resizing ? 'is-resizing' : ''}`} aria-hidden="true">{directions.map(direction => <div key={direction} data-testid={`resize-${direction}`} className={`resize-edge resize-${direction}`} title="拖动边缘或四角调整窗口大小" onPointerDown={event => begin(event, direction)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/>)}</div>{error && <div className="resize-error" role="status">{error}</div>}</>;
}
