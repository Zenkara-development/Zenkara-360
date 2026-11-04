import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ScanFace } from 'lucide-react';
import { Modal, Button, Alert } from './index';
import { detectFace, openCamera, snapshotDataUrl, stopStream, loadFaceApi, type FaceCapture } from '../face';

export interface FaceSample { descriptor: number[]; selfie: string }

interface Props {
  open: boolean;
  onClose: () => void;
  /** 'enrol' captures `samples` frames from slightly different angles; 'verify' captures one. */
  mode: 'enrol' | 'verify';
  samples?: number;
  onCaptured: (samples: FaceSample[]) => Promise<void> | void;
  title?: string;
  subtitle?: string;
}

const HINTS: Record<string, string> = {
  none: 'No face detected — move into the frame and face the camera.',
  multiple: 'More than one face in view — make sure only you are visible.',
  small: 'Move a little closer to the camera.',
};

/**
 * Webcam capture with live face detection. Auto-captures when a single face is
 * steadily detected for a few frames, so the employee just looks at the camera.
 */
export function FaceCaptureModal({ open, onClose, mode, samples = 3, onCaptured, title, subtitle }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef<FaceSample[]>([]);
  const [phase, setPhase] = useState<'loading' | 'camera' | 'detecting' | 'submitting' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('Starting camera…');
  const [count, setCount] = useState(0);
  const [box, setBox] = useState<FaceCapture['box'] | null>(null);
  const target = mode === 'enrol' ? samples : 1;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let stableFrames = 0;
    let lastCaptureAt = 0;
    capturedRef.current = [];
    setCount(0); setError(''); setPhase('loading'); setHint('Loading face model…');

    (async () => {
      try {
        await loadFaceApi();
        if (cancelled) return;
        setHint('Starting camera…');
        const stream = await openCamera();
        if (cancelled) { stopStream(stream); return; }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setPhase('detecting');
        setHint('Look straight at the camera.');

        const loop = async () => {
          if (cancelled) return;
          const v = videoRef.current;
          if (!v || v.readyState < 2) { setTimeout(loop, 150); return; }
          try {
            const result = await detectFace(v);
            if (cancelled) return;
            if (result.status !== 'ok') {
              stableFrames = 0; setBox(null); setHint(HINTS[result.status]);
            } else {
              setBox(result.capture.box);
              stableFrames += 1;
              const now = Date.now();
              // Hold steady for ~3 frames, and space enrolment samples ~1.2s apart so they differ a bit
              if (stableFrames >= 3 && now - lastCaptureAt > (mode === 'enrol' ? 1200 : 0)) {
                capturedRef.current.push({ descriptor: result.capture.descriptor, selfie: snapshotDataUrl(v) });
                lastCaptureAt = now; stableFrames = 0;
                const n = capturedRef.current.length;
                setCount(n);
                if (n >= target) {
                  setPhase('submitting'); setHint('Verifying…');
                  stopStream(streamRef.current); streamRef.current = null;
                  try {
                    await onCaptured(capturedRef.current);
                    if (!cancelled) setPhase('done');
                  } catch (err: any) {
                    if (!cancelled) { setPhase('error'); setError(err?.response?.data?.error || err?.message || 'Verification failed.'); }
                  }
                  return;
                }
                setHint(n === 1 ? 'Great — now turn your head slightly to the left.' : 'And slightly to the right.');
              } else if (stableFrames < 3) {
                setHint('Hold still…');
              }
            }
          } catch (err: any) {
            if (!cancelled) { setPhase('error'); setError(err?.message || 'Face detection failed.'); return; }
          }
          setTimeout(loop, 120);
        };
        loop();
      } catch (err: any) {
        if (!cancelled) { setPhase('error'); setError(err?.message || 'Could not start face capture.'); }
      }
    })();

    return () => {
      cancelled = true;
      stopStream(streamRef.current); streamRef.current = null;
    };
  }, [open, mode, target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? (mode === 'enrol' ? 'Enrol your face' : 'Face verification')}
      subtitle={subtitle ?? (mode === 'enrol'
        ? `We'll capture ${samples} quick samples. Only a numeric face signature is stored — not the photos — and you can remove it any time.`
        : 'Look at the camera to confirm it\'s you. This is compared with your enrolled face.')}
      icon={<ScanFace size={16} />}
      size="md"
      footer={
        phase === 'done' ? <Button icon={<CheckCircle2 size={14} />} onClick={onClose}>Done</Button>
        : phase === 'error' ? <Button variant="secondary" onClick={onClose}>Close</Button>
        : <Button variant="ghost" onClick={onClose}>Cancel</Button>
      }
    >
      <div className="space-y-3">
        <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3] max-h-[360px] mx-auto">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover -scale-x-100" data-testid="face-video" />
          {box && phase === 'detecting' && (
            <div
              className="absolute border-2 border-success rounded-md pointer-events-none transition-all"
              style={{ left: `${(1 - box.x - box.width) * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
            />
          )}
          {(phase === 'loading' || phase === 'submitting') && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm gap-2">
              <Camera size={16} className="animate-pulse" /> {hint}
            </div>
          )}
          {phase === 'done' && (
            <div className="absolute inset-0 flex items-center justify-center bg-success/70 text-white text-sm gap-2">
              <CheckCircle2 size={18} /> {mode === 'enrol' ? 'Face enrolled' : 'Verified'}
            </div>
          )}
        </div>

        {phase === 'detecting' && (
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-fg-muted" data-testid="face-hint">{hint}</span>
            {mode === 'enrol' && <span className="text-fg-subtle tabular-nums">{count} / {target}</span>}
          </div>
        )}
        {phase === 'error' && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
