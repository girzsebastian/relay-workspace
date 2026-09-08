import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { call, type Session } from "./types";
import "@xterm/xterm/css/xterm.css";
export default function Terminal({
  session,
  onError,
}: {
  session: Session;
  onError: (error: unknown) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const error = useRef(onError);
  error.current = onError;
  const status = useRef(session.status);
  status.current = session.status;
  useEffect(() => {
    const term = new XTerm({
      fontFamily: "SFMono-Regular, Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#131416",
        foreground: "#d5d7de",
        cursor: "#a4d6b3",
        selectionBackground: "#354058",
        black: "#131416",
        green: "#9dcda7",
        brightGreen: "#c0e3bb",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current!);
    let disposed = false,
      loaded = false;
    const pending: { data: string; sequence: number }[] = [];
    const unsubscribe = window.relay?.subscribe((event) => {
      if (
        event.type === "terminal-data" &&
        event.id === session.id &&
        event.data
      ) {
        if (loaded) term.write(event.data);
        else pending.push({ data: event.data, sequence: event.sequence || 0 });
      }
    });
    call<{ data: string; sequence: number }>("terminal:log", { id: session.id })
      .then((log) => {
        if (disposed) return;
        term.write(log.data);
        for (const event of pending)
          if (event.sequence > log.sequence) term.write(event.data);
        loaded = true;
      })
      .catch(error.current);
    const input = term.onData((data) => {
      if (status.current === "running")
        call("terminal:write", { id: session.id, data }).catch(error.current);
    });
    const observer = new ResizeObserver(() => {
      if (disposed || !container.current?.clientHeight) return;
      fit.fit();
      call("terminal:resize", {
        id: session.id,
        cols: term.cols,
        rows: term.rows,
      }).catch(error.current);
    });
    observer.observe(container.current!);
    fit.fit();
    return () => {
      disposed = true;
      unsubscribe?.();
      observer.disconnect();
      input.dispose();
      term.dispose();
    };
  }, [session.id]);
  return (
    <div
      className="terminal-canvas"
      ref={container}
      aria-label={`${session.title} terminal`}
    />
  );
}
