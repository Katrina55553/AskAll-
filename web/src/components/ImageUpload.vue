<template>
  <div class="image-upload">
    <el-upload
      :file-list="fileList"
      :auto-upload="false"
      :on-change="onChange"
      :on-remove="onRemove"
      list-type="picture-card"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
    >
      <el-icon><Plus /></el-icon>
    </el-upload>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

const emit = defineEmits(["update:files"]);
const fileList = ref([]);
const files = ref([]);
const MAX_SIZE = 10 * 1024 * 1024;

function onChange(uploadFile) {
  if (uploadFile.size > MAX_SIZE) {
    ElMessage.error("图片不能超过 10MB");
    fileList.value = fileList.value.filter((f) => f.uid !== uploadFile.uid);
    return;
  }
  files.value.push(uploadFile.raw);
  emit("update:files", files.value);
}

function onRemove(uploadFile) {
  files.value = files.value.filter((f) => f.uid !== uploadFile.raw.uid);
  emit("update:files", files.value);
}

function clear() {
  fileList.value = [];
  files.value = [];
  emit("update:files", []);
}

defineExpose({ clear });
</script>

<style scoped>
.image-upload :deep(.el-upload--picture-card) {
  width: 60px;
  height: 60px;
}
.image-upload :deep(.el-upload-list--picture-card .el-upload-list__item) {
  width: 60px;
  height: 60px;
}
</style>
