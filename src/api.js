export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({ error: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' }));
  if (!response.ok) {
    const error = new Error(data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    error.status = response.status;
    error.code = data.code;
    if (data.currentTask) error.currentTask = data.currentTask;
    throw error;
  }
  return data;
}
