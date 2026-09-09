import { useLayoutEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp } from "lucide-react";
import Markdown from "./Markdown";
import ChatSteps from "./ChatSteps";
import MessageChanges from "./MessageChanges";
import type { Chat, Role } from "./types";

type Message = Chat["messages"][number];

export default function ChatMessage({
  message,
  chat,
  projectId,
  roleName,
  running,
  onOpenFile,
  onError,
}: {
  message: Message;
  chat: Chat;
  projectId: string;
  roleName?: string;
  running: boolean;
  onOpenFile?: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // Whether a message is long enough to be worth collapsing is a question about
  // the rendered height, not the character count, so it is measured.
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || message.role !== "user") return;
    setClipped(element.scrollHeight - element.clientHeight > 4);
  }, [message.content, message.role, expanded]);
  const mine = message.role === "user";
  return (
    <div className={`chat-message ${message.role}`}>
      <div className="message-author">
        {mine ? <span className="tiny-avatar">Y</span> : <Bot size={15} />}
        <b>{mine ? "You" : roleName}</b>
      </div>
      <div
        ref={body}
        className={mine && !expanded ? "message-text clamped" : "message-text"}
      >
        {mine ? message.content : <Markdown text={message.content} />}
      </div>
      {mine && (clipped || expanded) && (
        <button className="message-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {message.steps && message.steps.length > 0 && (
        <ChatSteps
          steps={message.steps}
          durationMs={message.durationMs}
          running={running}
        />
      )}
      {!mine && (message.changed?.length || message.reverted) && (
        <MessageChanges
          projectId={projectId}
          chatId={chat.id}
          messageId={message.id}
          repos={message.changed || []}
          reverted={message.reverted}
          onOpenFile={onOpenFile}
          onError={onError}
        />
      )}
    </div>
  );
}

export type { Role };
