<template>
  <el-card v-if="hasContent" class="result-panel">
    <template #header>
      <div class="header">
        <span>{{ $t("result.summary") }}</span>
        <el-tag v-if="rounds > 1" size="small" type="warning">
          {{ $t("result.splitRounds", { rounds }) }}
        </el-tag>
        <el-tag v-if="summarizing" size="small" type="info">
          {{ $t("common.loading") }}
        </el-tag>
      </div>
    </template>

    <div class="summary-text" v-if="summary">{{ summary }}</div>
    <el-skeleton v-else-if="summarizing" :rows="3" animated />
    <p v-else class="muted">{{ $t("result.noSummary") }}</p>

    <el-divider v-if="answerList.length" />
    <el-collapse v-if="answerList.length">
      <el-collapse-item
        v-for="item in answerList"
        :key="item.botId"
        :title="item.botName"
        :name="item.botId"
      >
        <template #title>
          <span class="answer-title">
            {{ item.botName }}
            <el-tag
              size="small"
              :type="item.status === 'done' ? 'success' : 'danger'"
            >
              {{ $t(`progress.${item.status === "done" ? "done" : "error"}`) }}
            </el-tag>
            <span class="duration" v-if="item.durationMs != null">
              {{ (item.durationMs / 1000).toFixed(1) }}s
            </span>
          </span>
        </template>
        <div class="answer-text" v-if="item.answer">{{ item.answer }}</div>
        <el-alert v-else :title="item.error" type="error" :closable="false" />
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  summary: { type: String, default: "" },
  rounds: { type: Number, default: 0 },
  summarizing: { type: Boolean, default: false },
  answers: { type: Object, default: () => ({}) }, // botId -> item
});

const answerList = computed(() => Object.values(props.answers));
const hasContent = computed(
  () => props.summary || props.summarizing || answerList.value.length
);
</script>

<style scoped>
.result-panel {
  margin-top: 16px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.summary-text,
.answer-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
  max-height: 400px;
  overflow-y: auto;
}
.answer-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.duration {
  color: #909399;
  font-size: 12px;
}
.muted {
  color: #909399;
}
</style>
