"use client";

import { useEffect, useRef } from "react";
import type { PromptReference } from "@/generation/references";
import { AudioIcon, VideoIcon } from "./icons";

export function ReferenceSuggestions({ id, references, active, empty, onPick, onActive }: {
  id: string;
  references: PromptReference[];
  active: number;
  empty: string;
  onPick: (reference: PromptReference) => void;
  onActive: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="ohf-references">
      <div className="ohf-references-head">
        <span>Reference an input</span>
        <span><kbd>↑↓</kbd> choose · <kbd>Tab</kbd> insert</span>
      </div>
      <div id={id} role="listbox" aria-label="Prompt references" className="ohf-references-list ohf-scroll" ref={listRef}>
        {references.length === 0 && <div className="ohf-references-empty" role="status">{empty}</div>}
        {references.map((reference, index) => (
          <button
            key={reference.item.id}
            id={`${id}-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            tabIndex={-1}
            className="ohf-reference"
            onPointerDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(reference)}
          >
            <span className="ohf-reference-preview">
              {reference.item.role === "reference" ? (
                /* Public user-upload URL, matching the attachment strip. */
                <img src={reference.item.url} alt="" />
              ) : reference.item.role === "video" ? <VideoIcon size={18} /> : <AudioIcon size={18} />}
            </span>
            <span>{reference.token}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
