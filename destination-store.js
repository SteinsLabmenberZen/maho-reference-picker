// FileSystemDirectoryHandle can be structured-cloned by IndexedDB.
// Keep this database separate so existing collection history is not migrated.
let opening;
function db() {
  return opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('maho-picker-destination', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {database.close(); opening = null;};
      resolve(database);
    };
    request.onerror = () => {opening = null; reject(request.error);};
  });
}
export async function readDestination() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('settings').objectStore('settings').get('destination');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function writeDestination(value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('settings', 'readwrite');
    transaction.objectStore('settings').put(value, 'destination');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
