#include <napi.h>

#include <atomic>
#include <climits>
#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "s7_client.h"
#include "s7_text.h"
#include "s7_types.h"

namespace {

std::string ClientErrorText(int code) {
  char text[1024] = {0};
  ErrCliText(code, text, static_cast<int>(sizeof(text)));
  return std::string(text);
}

struct ClientState {
  ClientState() : client(std::make_unique<TSnap7Client>()) {}

  ~ClientState() {
    std::lock_guard<std::mutex> lock(mutex);
    client->Disconnect();
  }

  std::mutex mutex;
  std::unique_ptr<TSnap7Client> client;
  std::atomic<bool> connected{false};
};

int WordSize(int word_len) {
  switch (word_len) {
    case S7WLBit:
    case S7WLByte:
    case S7WLChar:
      return 1;
    case S7WLWord:
    case S7WLInt:
    case S7WLCounter:
    case S7WLTimer:
      return 2;
    case S7WLDWord:
    case S7WLDInt:
    case S7WLReal:
      return 4;
    default:
      return 0;
  }
}

bool ReadInt(const Napi::CallbackInfo& info, size_t index, const char* name,
             int minimum, int* value) {
  Napi::Env env = info.Env();
  if (index >= info.Length() || !info[index].IsNumber()) {
    Napi::TypeError::New(env, std::string(name) + " must be a number")
        .ThrowAsJavaScriptException();
    return false;
  }

  double number = info[index].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number != std::trunc(number) ||
      number < minimum || number > INT_MAX) {
    Napi::RangeError::New(env, std::string(name) + " is out of range")
        .ThrowAsJavaScriptException();
    return false;
  }

  *value = static_cast<int>(number);
  return true;
}

bool ReadBytes(const Napi::CallbackInfo& info, size_t index,
               std::vector<uint8_t>* bytes) {
  Napi::Env env = info.Env();
  if (index >= info.Length() || !info[index].IsTypedArray()) {
    Napi::TypeError::New(env, "data must be a Buffer or Uint8Array")
        .ThrowAsJavaScriptException();
    return false;
  }

  Napi::TypedArray array = info[index].As<Napi::TypedArray>();
  if (array.TypedArrayType() != napi_uint8_array) {
    Napi::TypeError::New(env, "data must be a Buffer or Uint8Array")
        .ThrowAsJavaScriptException();
    return false;
  }

  Napi::Uint8Array data = info[index].As<Napi::Uint8Array>();
  bytes->assign(data.Data(), data.Data() + data.ByteLength());
  return true;
}

class ClientWorker : public Napi::AsyncWorker {
 public:
  ClientWorker(Napi::Env env, std::shared_ptr<ClientState> state)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        state_(std::move(state)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() final {
    std::lock_guard<std::mutex> lock(state_->mutex);
    error_code_ = ExecuteLocked(*state_->client);
    state_->connected.store(state_->client->Connected,
                            std::memory_order_relaxed);
    if (error_code_ != 0) {
      SetError(ClientErrorText(error_code_));
    }
  }

  void OnOK() final { deferred_.Resolve(Result(Env())); }

  void OnError(const Napi::Error& error) final {
    Napi::Object value = error.Value();
    value.Set("name", "Snap7Error");
    value.Set("code", Napi::Number::New(Env(), error_code_));
    deferred_.Reject(value);
  }

 protected:
  virtual int ExecuteLocked(TSnap7Client& client) = 0;
  virtual Napi::Value Result(Napi::Env env) { return env.Undefined(); }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<ClientState> state_;
  int error_code_ = 0;
};

class ConnectWorker final : public ClientWorker {
 public:
  ConnectWorker(Napi::Env env, std::shared_ptr<ClientState> state,
                std::string address, int rack, int slot)
      : ClientWorker(env, std::move(state)),
        address_(std::move(address)),
        rack_(rack),
        slot_(slot) {}

 protected:
  int ExecuteLocked(TSnap7Client& client) override {
    return client.ConnectTo(address_.c_str(), rack_, slot_);
  }

 private:
  std::string address_;
  int rack_;
  int slot_;
};

class DisconnectWorker final : public ClientWorker {
 public:
  using ClientWorker::ClientWorker;

 protected:
  int ExecuteLocked(TSnap7Client& client) override {
    return client.Disconnect();
  }
};

class ReadWorker final : public ClientWorker {
 public:
  enum class Kind { Db, Area };

  ReadWorker(Napi::Env env, std::shared_ptr<ClientState> state, int db_number,
             int start, int size)
      : ClientWorker(env, std::move(state)),
        kind_(Kind::Db),
        db_number_(db_number),
        start_(start),
        amount_(size),
        data_(static_cast<size_t>(size)) {}

  ReadWorker(Napi::Env env, std::shared_ptr<ClientState> state, int area,
             int db_number, int start, int amount, int word_len, size_t size)
      : ClientWorker(env, std::move(state)),
        kind_(Kind::Area),
        area_(area),
        db_number_(db_number),
        start_(start),
        amount_(amount),
        word_len_(word_len),
        data_(size) {}

 protected:
  int ExecuteLocked(TSnap7Client& client) override {
    if (kind_ == Kind::Db) {
      return client.DBRead(db_number_, start_, amount_, data_.data());
    }
    return client.ReadArea(area_, db_number_, start_, amount_, word_len_,
                           data_.data());
  }

  Napi::Value Result(Napi::Env env) override {
    return Napi::Buffer<uint8_t>::Copy(env, data_.data(), data_.size());
  }

 private:
  Kind kind_;
  int area_ = S7AreaDB;
  int db_number_;
  int start_;
  int amount_;
  int word_len_ = S7WLByte;
  std::vector<uint8_t> data_;
};

class WriteWorker final : public ClientWorker {
 public:
  enum class Kind { Db, Area };

  WriteWorker(Napi::Env env, std::shared_ptr<ClientState> state, int db_number,
              int start, std::vector<uint8_t> data)
      : ClientWorker(env, std::move(state)),
        kind_(Kind::Db),
        db_number_(db_number),
        start_(start),
        amount_(static_cast<int>(data.size())),
        data_(std::move(data)) {}

  WriteWorker(Napi::Env env, std::shared_ptr<ClientState> state, int area,
              int db_number, int start, int amount, int word_len,
              std::vector<uint8_t> data)
      : ClientWorker(env, std::move(state)),
        kind_(Kind::Area),
        area_(area),
        db_number_(db_number),
        start_(start),
        amount_(amount),
        word_len_(word_len),
        data_(std::move(data)) {}

 protected:
  int ExecuteLocked(TSnap7Client& client) override {
    if (kind_ == Kind::Db) {
      return client.DBWrite(db_number_, start_, amount_, data_.data());
    }
    return client.WriteArea(area_, db_number_, start_, amount_, word_len_,
                            data_.data());
  }

 private:
  Kind kind_;
  int area_ = S7AreaDB;
  int db_number_;
  int start_;
  int amount_;
  int word_len_ = S7WLByte;
  std::vector<uint8_t> data_;
};

class NativeS7Client final : public Napi::ObjectWrap<NativeS7Client> {
 public:
  static Napi::Function Define(Napi::Env env) {
    return DefineClass(
        env, "NativeS7Client",
        {
            InstanceMethod("connectTo", &NativeS7Client::ConnectTo),
            InstanceMethod("disconnect", &NativeS7Client::Disconnect),
            InstanceMethod("dbRead", &NativeS7Client::DbRead),
            InstanceMethod("dbWrite", &NativeS7Client::DbWrite),
            InstanceMethod("readArea", &NativeS7Client::ReadArea),
            InstanceMethod("writeArea", &NativeS7Client::WriteArea),
            InstanceAccessor("connected", &NativeS7Client::Connected, nullptr),
        });
  }

  explicit NativeS7Client(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<NativeS7Client>(info),
        state_(std::make_shared<ClientState>()) {}

 private:
  Napi::Value ConnectTo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsString()) {
      Napi::TypeError::New(env, "connectTo requires address, rack and slot")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    int rack;
    int slot;
    if (!ReadInt(info, 1, "rack", 0, &rack) ||
        !ReadInt(info, 2, "slot", 0, &slot)) {
      return env.Undefined();
    }
    std::string address = info[0].As<Napi::String>().Utf8Value();
    if (address.empty() || address.size() > 15) {
      Napi::RangeError::New(env, "address must be an IPv4 address")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    auto* worker =
        new ConnectWorker(env, state_, std::move(address), rack, slot);
    worker->Queue();
    return worker->Promise();
  }

  Napi::Value Disconnect(const Napi::CallbackInfo& info) {
    auto* worker = new DisconnectWorker(info.Env(), state_);
    worker->Queue();
    return worker->Promise();
  }

  Napi::Value DbRead(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int db_number;
    int start;
    int size;
    if (!ReadInt(info, 0, "dbNumber", 0, &db_number) ||
        !ReadInt(info, 1, "start", 0, &start) ||
        !ReadInt(info, 2, "size", 1, &size)) {
      return env.Undefined();
    }
    auto* worker = new ReadWorker(env, state_, db_number, start, size);
    worker->Queue();
    return worker->Promise();
  }

  Napi::Value DbWrite(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int db_number;
    int start;
    std::vector<uint8_t> data;
    if (!ReadInt(info, 0, "dbNumber", 0, &db_number) ||
        !ReadInt(info, 1, "start", 0, &start) ||
        !ReadBytes(info, 2, &data)) {
      return env.Undefined();
    }
    if (data.empty() || data.size() > static_cast<size_t>(INT_MAX)) {
      Napi::RangeError::New(env, "data length is out of range")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    auto* worker =
        new WriteWorker(env, state_, db_number, start, std::move(data));
    worker->Queue();
    return worker->Promise();
  }

  Napi::Value ReadArea(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int area;
    int db_number;
    int start;
    int amount;
    int word_len;
    if (!ReadInt(info, 0, "area", 0, &area) ||
        !ReadInt(info, 1, "dbNumber", 0, &db_number) ||
        !ReadInt(info, 2, "start", 0, &start) ||
        !ReadInt(info, 3, "amount", 1, &amount) ||
        !ReadInt(info, 4, "wordLen", 0, &word_len)) {
      return env.Undefined();
    }
    int word_size = WordSize(word_len);
    if (word_size == 0 || (word_len == S7WLBit && amount != 1)) {
      Napi::RangeError::New(env, "invalid wordLen or bit amount")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    size_t size = static_cast<size_t>(amount) * word_size;
    if (size > static_cast<size_t>(INT_MAX)) {
      Napi::RangeError::New(env, "requested buffer is too large")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    auto* worker = new ReadWorker(env, state_, area, db_number, start, amount,
                                  word_len, size);
    worker->Queue();
    return worker->Promise();
  }

  Napi::Value WriteArea(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int area;
    int db_number;
    int start;
    int word_len;
    std::vector<uint8_t> data;
    if (!ReadInt(info, 0, "area", 0, &area) ||
        !ReadInt(info, 1, "dbNumber", 0, &db_number) ||
        !ReadInt(info, 2, "start", 0, &start) ||
        !ReadInt(info, 3, "wordLen", 0, &word_len) ||
        !ReadBytes(info, 4, &data)) {
      return env.Undefined();
    }
    int word_size = WordSize(word_len);
    if (word_size == 0 || data.empty() ||
        data.size() % static_cast<size_t>(word_size) != 0 ||
        (word_len == S7WLBit && data.size() != 1)) {
      Napi::RangeError::New(env, "data length does not match wordLen")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    size_t amount_size = data.size() / static_cast<size_t>(word_size);
    if (amount_size > static_cast<size_t>(INT_MAX)) {
      Napi::RangeError::New(env, "data is too large")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    auto* worker = new WriteWorker(env, state_, area, db_number, start,
                                   static_cast<int>(amount_size), word_len,
                                   std::move(data));
    worker->Queue();
    return worker->Promise();
  }

  Napi::Value Connected(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(
        info.Env(), state_->connected.load(std::memory_order_relaxed));
  }

  std::shared_ptr<ClientState> state_;
};

Napi::Object MakeArea(Napi::Env env) {
  Napi::Object value = Napi::Object::New(env);
  value.Set("PE", S7AreaPE);
  value.Set("PA", S7AreaPA);
  value.Set("MK", S7AreaMK);
  value.Set("DB", S7AreaDB);
  value.Set("CT", S7AreaCT);
  value.Set("TM", S7AreaTM);
  return value;
}

Napi::Object MakeWordLen(Napi::Env env) {
  Napi::Object value = Napi::Object::New(env);
  value.Set("Bit", S7WLBit);
  value.Set("Byte", S7WLByte);
  value.Set("Char", S7WLChar);
  value.Set("Word", S7WLWord);
  value.Set("Int", S7WLInt);
  value.Set("DWord", S7WLDWord);
  value.Set("DInt", S7WLDInt);
  value.Set("Real", S7WLReal);
  value.Set("Counter", S7WLCounter);
  value.Set("Timer", S7WLTimer);
  return value;
}

Napi::Value ErrorText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int code;
  if (!ReadInt(info, 0, "code", std::numeric_limits<int>::min(), &code)) {
    return env.Undefined();
  }
  return Napi::String::New(env, ClientErrorText(code));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("NativeS7Client", NativeS7Client::Define(env));
  exports.Set("Area", MakeArea(env));
  exports.Set("WordLen", MakeWordLen(env));
  exports.Set("errorText", Napi::Function::New(env, ErrorText));
  return exports;
}

}  // namespace

NODE_API_MODULE(snap7, Init)
