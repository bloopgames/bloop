import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

export function useAutoScroll(threshold = 80) {
  const container = ref<HTMLElement | null>(null);
  let autoScroll = true;

  function onScroll() {
    if (!container.value) return;
    const el = container.value;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    autoScroll = distanceFromBottom < threshold;
  }

  async function scrollToBottom() {
    if (!container.value) return;
    await nextTick(); // wait for DOM updates
    const el = container.value;
    el.scrollTop = el.scrollHeight;
  }

  async function onContentUpdated() {
    if (autoScroll) {
      await scrollToBottom();
    }
  }

  onMounted(() => {
    container.value?.addEventListener("scroll", onScroll);
  });
  onBeforeUnmount(() => {
    container.value?.removeEventListener("scroll", onScroll);
  });

  return {
    container,
    onContentUpdated,
    scrollToBottom,
  };
}
