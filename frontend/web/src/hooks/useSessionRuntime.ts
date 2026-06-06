import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  createSessionRaw,
  listPermissionsRaw,
  listQuestionsRaw,
  listMessagesRaw,
  listSessionsRaw,
  rejectQuestion,
  replyPermission,
  replyQuestion,
  sendPromptAsync,
  subscribeEvents,
} from '../lib/mon_agent_api';
import { getStoredToken } from '../lib/auth';
import {
  applyRuntimeEvent,
  hydratePendingPermissions,
  hydratePendingQuestions,
  hydrateSessionList,
  hydrateSessionMessages,
  initialRuntimeState,
  resetRuntime,
  runtimeReducer,
  setActiveSession,
  setConnectionState,
  setConnectionError,
} from '../lib/session-reducer';
import { selectActiveSession, selectPendingPermissions, selectPendingQuestions, selectSessions, selectSessionStatus } from '../lib/session-selectors';
import type { PromptAttachment } from '../types';

export function useSessionRuntime(enabled = true) {
  const [state, dispatch] = useReducer(runtimeReducer, initialRuntimeState);
  const activeSessionIdRef = useRef<string | undefined>(state.activeSessionId);
  const hasOpenedStreamRef = useRef(false);
  const sendingSessionIdsRef = useRef(new Set<string>());

  const isRuntimeReady = useCallback(() => enabled && Boolean(getStoredToken()), [enabled]);

  useEffect(() => {
    activeSessionIdRef.current = state.activeSessionId;
  }, [state.activeSessionId]);

  useEffect(() => {
    for (const [sessionID, session] of Object.entries(state.sessions)) {
      if (session.status === 'idle') {
        sendingSessionIdsRef.current.delete(sessionID);
      } else {
        sendingSessionIdsRef.current.add(sessionID);
      }
    }
  }, [state.sessions]);

  useEffect(() => {
    if (enabled) return;
    hasOpenedStreamRef.current = false;
    dispatch(resetRuntime());
  }, [enabled]);

  const refreshSessions = useCallback(async () => {
    if (!isRuntimeReady()) return [];
    const sessions = await listSessionsRaw();
    dispatch(hydrateSessionList(sessions));
    return sessions;
  }, [isRuntimeReady]);

  const refreshSessionMessages = useCallback(async (sessionID?: string) => {
    if (!sessionID || !isRuntimeReady()) return;
    const messages = await listMessagesRaw(sessionID);
    dispatch(hydrateSessionMessages(sessionID, messages));
  }, [isRuntimeReady]);

  const refreshBlockers = useCallback(async () => {
    if (!isRuntimeReady()) return;
    const [permissions, questions] = await Promise.all([listPermissionsRaw(), listQuestionsRaw()]);
    dispatch(hydratePendingPermissions(permissions));
    dispatch(hydratePendingQuestions(questions));
  }, [isRuntimeReady]);

  useEffect(() => {
    if (!isRuntimeReady()) return;
    let cancelled = false;

    async function load() {
      try {
        const sessions = await refreshSessions();
        if (cancelled) return;
        const firstSessionID = activeSessionIdRef.current ?? sessions[0]?.id;
        if (firstSessionID) {
          await refreshSessionMessages(firstSessionID);
        }
        await refreshBlockers();
      } catch (error) {
        if (cancelled) return;
        dispatch(setConnectionError(error instanceof Error ? error.message : String(error)));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isRuntimeReady, refreshBlockers, refreshSessionMessages, refreshSessions]);

  useEffect(() => {
    if (!isRuntimeReady()) return;
    const sessionID = state.activeSessionId;
    if (!sessionID) return;
    const session = state.sessions[sessionID];
    if (session?.hydrated) return;

    let cancelled = false;

    async function hydrate() {
      try {
        const messages = await listMessagesRaw(sessionID);
        if (cancelled) return;
        dispatch(hydrateSessionMessages(sessionID, messages));
      } catch (error) {
        if (cancelled) return;
        dispatch(setConnectionError(error instanceof Error ? error.message : String(error)));
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [isRuntimeReady, state.activeSessionId, state.sessions]);

  useEffect(() => {
    if (!isRuntimeReady()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void subscribeEvents({
      onOpen: () => {
        dispatch(setConnectionState('connected'));
        const sessionID = activeSessionIdRef.current;
        const reconcile = async () => {
          if (!isRuntimeReady()) return;
          try {
            await Promise.all([refreshSessions(), refreshBlockers()]);
            if (sessionID) {
              await refreshSessionMessages(sessionID);
            }
          } catch (error) {
            dispatch(setConnectionError(error instanceof Error ? error.message : String(error)));
          }
        };

        if (!hasOpenedStreamRef.current) {
          hasOpenedStreamRef.current = true;
          return;
        }

        void reconcile();
      },
      onError: (error) => {
        dispatch(setConnectionState('disconnected'));
        dispatch(setConnectionError(error));
      },
      onEvent: (event) => {
        dispatch(applyRuntimeEvent(event));
      },
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        cleanup = dispose;
      })
      .catch((error) => {
        dispatch(setConnectionError(error instanceof Error ? error.message : String(error)));
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isRuntimeReady, refreshBlockers, refreshSessionMessages, refreshSessions]);

  const createSession = useCallback(async () => {
    if (!isRuntimeReady()) throw new Error('MonAgent runtime is not authenticated');
    try {
      const session = await createSessionRaw();
      activeSessionIdRef.current = session.id;
      dispatch(hydrateSessionList([session]));
      dispatch(setActiveSession(session.id));
      return session;
    } catch (error) {
      dispatch(setConnectionError(error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }, [isRuntimeReady]);

  const chooseSession = useCallback((sessionID?: string) => {
    activeSessionIdRef.current = sessionID;
    dispatch(setActiveSession(sessionID));
  }, []);

  const sendMessage = useCallback(
    async (content: string, attachments: PromptAttachment[]) => {
      let sessionID = activeSessionIdRef.current;
      if (!isRuntimeReady()) {
        throw new Error('MonAgent runtime is not authenticated');
      }
      if (!sessionID) {
        const session = await createSession();
        sessionID = session.id;
      }
      if (!sessionID) {
        throw new Error('No active session');
      }
      if (sendingSessionIdsRef.current.has(sessionID)) {
        return;
      }

      sendingSessionIdsRef.current.add(sessionID);
      dispatch(setConnectionError(undefined));
      try {
        await sendPromptAsync(sessionID, content, attachments);
      } catch (error) {
        sendingSessionIdsRef.current.delete(sessionID);
        dispatch(setConnectionError(error instanceof Error ? error.message : String(error)));
        throw error;
      }
    },
    [createSession, isRuntimeReady, state.activeSessionId],
  );

  const respondPermission = useCallback(async (requestID: string, reply: 'once' | 'always' | 'reject', message?: string) => {
    await replyPermission(requestID, reply, message);
  }, []);

  const answerQuestion = useCallback(async (requestID: string, answers: string[][]) => {
    await replyQuestion(requestID, answers);
  }, []);

  const dismissQuestion = useCallback(async (requestID: string) => {
    await rejectQuestion(requestID);
  }, []);

  const sessions = useMemo(() => selectSessions(state), [state]);
  const activeSession = useMemo(() => selectActiveSession(state), [state]);
  const pendingPermissions = useMemo(() => selectPendingPermissions(state, state.activeSessionId), [state]);
  const pendingQuestions = useMemo(() => selectPendingQuestions(state, state.activeSessionId), [state]);
  const isThinking = selectSessionStatus(state, state.activeSessionId) !== 'idle';
  const activeSessionError = state.activeSessionId ? state.sessions[state.activeSessionId]?.error : undefined;

  return {
    activeSession,
    activeSessionId: state.activeSessionId ?? '',
    activeSessionError,
    answerQuestion,
    connectionState: state.connectionState,
    connectionError: state.connectionError,
    createSession,
    dismissQuestion,
    isThinking,
    pendingPermissions,
    pendingQuestions,
    respondPermission,
    reset: () => dispatch(resetRuntime()),
    selectSession: chooseSession,
    sendMessage,
    sessions,
  };
}
