import { useRef, useCallback, useEffect } from "preact/hooks";

export function useAutoScroll(threshold = 80) {
  const containerRef = useRef<HTMLElement | null>(null);
  const autoScrollRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < threshold;
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Use requestAnimationFrame for DOM update timing
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const onContentUpdated = useCallback(() => {
    if (autoScrollRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  // Set up scroll listener when ref changes
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener("scroll", onScroll);
      return () => el.removeEventListener("scroll", onScroll);
    }
  }, [onScroll]);

  // Return ref callback to set containerRef
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      // Clean up old listener
      if (containerRef.current) {
        containerRef.current.removeEventListener("scroll", onScroll);
      }
      containerRef.current = el;
      // Add new listener
      if (el) {
        el.addEventListener("scroll", onScroll);
      }
    },
    [onScroll],
  );

  return {
    containerRef: setRef,
    onContentUpdated,
    scrollToBottom,
  };
}
