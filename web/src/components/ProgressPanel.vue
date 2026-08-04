<template>
  <el-card v-if="items.length" class="progress-panel">
    <div
      v-for="item in sortedItems"
      :key="item.botId"
      class="progress-row"
    >
      <span class="bot-name">{{ item.botName }}</span>
      <el-tag
        size="small"
        :type="tagType(item.status)"
        :effect="item.status === 'answering' ? 'dark' : 'light'"
      >
        {{ $t(`progress.${item.status}`) }}
      </el-tag>
      <span class="duration" v-if="item.durationMs != null">
        {{ (item.durationMs / 1000).toFixed(1) }}s
      </span>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  items: { type: Array, default: () => [] }, // {botId, botName, status, durationMs}
});

const ORDER = { done: 0, error: 1, answering: 2, pending: 3 };
const sortedItems = computed(() =>
  [...props.items].sort(
    (a, b) =>
      (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) ||
      (a.durationMs ?? 0) - (b.durationMs ?? 0)
  )
);

function tagType(status) {
  return (
    { pending: "info", answering: "primary", done: "success", error: "danger" }[
      status
    ] || "info"
  );
}
</script>

<style scoped>
.progress-panel {
  margin-top: 16px;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.bot-name {
  flex: 1;
  font-size: 14px;
}
.duration {
  color: #909399;
  font-size: 12px;
}
</style>
