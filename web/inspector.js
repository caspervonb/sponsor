export function open(url) {
  return fetch(`http:localhost:9292/json/new?${url}`).then((response) => {
    return response.json();
  });
}

export function close(id) {
  return fetch(`http:localhost:9292/json/close/${id}`).then(
    (response) => {
      return response.json();
    },
  );
}

export function list() {
  return fetch("http:localhost:9292/json/list").then((response) => {
    return response.json();
  });
}

export function inspect(url) {
  let id = 0;

  const deferred = {};
  const socket = new WebSocket(url);
  const queue = [];
  const notifications = [];

  socket.onopen = function () {
    for (const { id, method, params } of queue) {
      socket.send(JSON.stringify({
        id: id,
        method,
        params,
      }));
    }
  };

  socket.onmessage = (message) => {
    const response = JSON.parse(message.data);

    if (response.id) {
      const promise = deferred[response.id];
      if (response.error) {
        promise.reject(response.error);
      } else {
        promise.resolve(response.result);
      }
    } else {
      notifications.push(response);
    }
  };

  return {
    close() {
      socket.close();
    },
    send(method, params) {
      id++;

      if (socket.readyState == WebSocket.OPEN) {
        socket.send(JSON.stringify({
          id,
          method,
          params,
        }));
      } else {
        queue.push({ id, method, params });
      }

      return new Promise((resolve, reject) => {
        deferred[id] = {
          resolve,
          reject,
        };
      });
    },
  };
}
