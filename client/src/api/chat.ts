import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface ChatUser { id: string; name: string; role?: string; department?: string | null }
export interface ChatThreadRow {
  id: string; kind: 'DM' | 'RECORD'; entityType: string | null; entityId: string | null;
  lastMessageAt: string | null; participants: ChatUser[];
  lastMessage: { body: string; authorName: string | null } | null; unread: number;
}
export interface ChatMessage {
  id: string; threadId: string; authorId: string | null; isAssistant: boolean;
  body: string; createdAt: string; author: { id: string; name: string } | null;
}

export const useChatThreads = () =>
  useQuery({ queryKey: ['chat-threads'], queryFn: () => api.get('/chat/threads').then(r => r.data as ChatThreadRow[]), refetchInterval: 30000 });

export const useChatPeople = () =>
  useQuery({ queryKey: ['chat-people'], queryFn: () => api.get('/chat/people').then(r => r.data as ChatUser[]), staleTime: 60000 });

export const useOpenDm = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post('/chat/dm', { userId }).then(r => r.data as { id: string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-threads'] }),
  });
};

export const useRecordThread = (entityType: string, entityId: string | undefined) =>
  useQuery({
    queryKey: ['chat-record-thread', entityType, entityId],
    queryFn: () => api.get(`/chat/record/${entityType}/${entityId}`).then(r => r.data as { id: string }),
    enabled: !!entityId,
  });

export const useChatMessages = (threadId: string | undefined) =>
  useQuery({
    queryKey: ['chat-messages', threadId],
    queryFn: () => api.get(`/chat/threads/${threadId}/messages`).then(r => r.data as {
      threadId: string; kind: string; participants: ChatUser[]; messages: ChatMessage[]; pendingPlan: any;
    }),
    enabled: !!threadId,
    refetchInterval: 15000, // safety net under SSE
  });

export const useSendChatMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
      api.post(`/chat/threads/${threadId}/messages`, { body }).then(r => r.data as ChatMessage),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', vars.threadId] });
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
    },
  });
};
