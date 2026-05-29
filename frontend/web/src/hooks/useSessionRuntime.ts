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
} from '../lib/opencode';
import {
  applyRuntimeEvent,
  hydratePendingPermissions,
  hydratePendingQuestions,
  hydrateSessionList,
  hydrateSessionMessages,
  initialRuntimeState,
  pushLocalUserMessage,
  runtimeReducer,
  setActiveSession,
  setConnectionState,
  setConnectionError,
} from '../lib/session-reducer';
import { selectActiveSession, selectPendingPermissions, selectPendingQuestions, selectSessions, selectSessionStatus } from '../lib/session-selectors';

export function useSessionRuntime() {
  const [state, dispatch] = useReducer(runtimeReducer, initialRuntimeState);
  const activeSessionIdRef = useRef<string | undefined>(state.activeSessionId);
  const hasOpenedStreamRef = useRef(false);

  useEffect(() => {
    activeSessionIdRef.current = state.activeSessionId;
  }, [state.activeSessionId]);

  const refreshSessions = useCallback(async () => {
    const sessions = await listSessionsRaw();
    dispatch(hydrateSessionList(sessions));
    return sessions;
  }, []);

  const refreshSessionMessages = useCallback(async (sessionID?: string) => {
    if (!sessionID) return;
    const messages = await listMessagesRaw(sessionID);
    dispatch(hydrateSessionMessages(sessionID, messages));
  }, []);

  const refreshBlockers = useCallback(async () => {
    const [permissions, questions] = await Promise.all([listPermissionsRaw(), listQuestionsRaw()]);
    dispatch(hydratePendingPermissions(permissions));
    dispatch(hydratePendingQuestions(questions));
  }, []);

  useEffect(() => {
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
  }, [refreshBlockers, refreshSessionMessages, refreshSessions]);

  useEffect(() => {
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
  }, [state.activeSessionId, state.sessions]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void subscribeEvents({
      onOpen: () => {
        dispatch(setConnectionState('connected'));
        const sessionID = activeSessionIdRef.current;
        const reconcile = async () => {
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
  }, [refreshBlockers, refreshSessionMessages, refreshSessions]);

  const createSession = useCallback(async () => {
    const session = await createSessionRaw();
    dispatch(hydrateSessionList([session]));
    dispatch(setActiveSession(session.id));
    return session;
  }, []);

  const chooseSession = useCallback((sessionID?: string) => {
    dispatch(setActiveSession(sessionID));
  }, []);

  const sendMessage = useCallback(
    async (content: string, images: string[]) => {
      let sessionID = state.activeSessionId;
      if (!sessionID) {
        const session = await createSession();
        sessionID = session.id;
      }
      if (!sessionID) {
        throw new Error('No active session');
      }

      dispatch(pushLocalUserMessage(sessionID, content, images));
      dispatch(setConnectionError(undefined));
      await sendPromptAsync(sessionID, content, images);
    },
    [createSession, state.activeSessionId],
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
    selectSession: chooseSession,
    sendMessage,
    sessions,
  };
}
