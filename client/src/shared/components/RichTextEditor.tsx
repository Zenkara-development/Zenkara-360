/**
 * RichTextEditor — TipTap-based formatting editor used wherever people write
 * content: comments, ticket descriptions, KB articles.
 *
 * Produces HTML (sanitised again server-side — utils/sanitizeHtml.ts).
 * Inline images are embedded as data URLs: the picker downsizes to ≤900px
 * JPEG before insertion, so a phone photo lands at ~100KB instead of 4MB and
 * the row stays portable (works in emails and exports, no auth-gated URL to
 * break). Toolbar deliberately stops at the formats people actually use.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote,
  Heading2, Image as ImageIcon, Link as LinkIcon, Undo2, Redo2,
} from 'lucide-react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Compact = comments/chat; full = documents (adds headings/quote). */
  variant?: 'compact' | 'full';
  minHeight?: number;
  ariaLabel?: string;
  /** Ctrl/Cmd+Enter — used by comment boxes to submit. */
  onSubmitShortcut?: () => void;
}

/** Downscale an image file to a bounded JPEG data URL. */
function fileToDataUrl(file: File, maxDim = 900, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG stays PNG if it has transparency-ish extension; JPEG otherwise.
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ToolButton({ onClick, active, label, children }: {
  onClick: () => void; active?: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={e => e.preventDefault() /* keep editor selection */}
      onClick={onClick}
      className={`p-1.5 rounded-btn transition-colors ${
        active ? 'bg-accent-soft text-accent-soft-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value, onChange, placeholder = 'Write something…', variant = 'compact',
  minHeight = 80, ariaLabel = 'Rich text editor', onSubmitShortcut,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef(onSubmitShortcut);
  submitRef.current = onSubmitShortcut;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editorProps: {
      attributes: { 'aria-label': ariaLabel, class: 'rich-text focus:outline-none' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && submitRef.current) {
          submitRef.current();
          return true;
        }
        return false;
      },
      // Pasting or dropping an image file embeds it like the toolbar button.
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'));
        if (file) { insertImage(file); return true; }
        return false;
      },
      handleDrop: (_view, event) => {
        const file = Array.from(event.dataTransfer?.files ?? []).find(f => f.type.startsWith('image/'));
        if (file) { insertImage(file); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  });

  /* External resets (e.g. the comment box clearing after post) — only push
     value in when it genuinely differs, or every keystroke would loop. */
  useEffect(() => {
    if (editor && value !== editor.getHTML() && !(value === '' && editor.isEmpty)) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  const insertImage = useCallback(async (file: File) => {
    if (!editor || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) return; // refuse absurd inputs pre-resize
    const src = await fileToDataUrl(file);
    editor.chain().focus().setImage({ src }).run();
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rounded-input border border-line bg-surface focus-within:ring-2 focus-within:ring-accent-ring">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-line-subtle flex-wrap">
        <ToolButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={13} /></ToolButton>
        <ToolButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={13} /></ToolButton>
        <ToolButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={13} /></ToolButton>
        <ToolButton label="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={13} /></ToolButton>
        <span className="w-px h-4 bg-line mx-0.5" />
        {variant === 'full' && (
          <>
            <ToolButton label="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={13} /></ToolButton>
            <ToolButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={13} /></ToolButton>
          </>
        )}
        <ToolButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={13} /></ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={13} /></ToolButton>
        <span className="w-px h-4 bg-line mx-0.5" />
        <ToolButton label="Link" active={editor.isActive('link')} onClick={setLink}><LinkIcon size={13} /></ToolButton>
        <ToolButton label="Insert image" onClick={() => fileRef.current?.click()}><ImageIcon size={13} /></ToolButton>
        <span className="ml-auto flex items-center gap-0.5">
          <ToolButton label="Undo" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={13} /></ToolButton>
          <ToolButton label="Redo" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={13} /></ToolButton>
        </span>
      </div>
      <div className="px-3 py-2 overflow-y-auto" style={{ minHeight, maxHeight: 420 }} onClick={() => editor.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden" aria-hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }}
      />
    </div>
  );
}
