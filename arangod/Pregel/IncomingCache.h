////////////////////////////////////////////////////////////////////////////////
/// DISCLAIMER
///
/// Copyright 2016 ArangoDB GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is ArangoDB GmbH, Cologne, Germany
///
/// @author Simon Grätzer
////////////////////////////////////////////////////////////////////////////////

#ifndef ARANGODB_IN_MESSAGE_CACHE_H
#define ARANGODB_IN_MESSAGE_CACHE_H 1

#include <velocypack/velocypack-aliases.h>
#include <velocypack/vpack.h>
#include <string>

#include "Basics/Common.h"
#include "Basics/Mutex.h"

#include "WorkerContext.h"

namespace arangodb {
namespace pregel {

template <typename M>
class MessageIterator {
 public:
  MessageIterator() : _data(nullptr), _size(0) {}

  typedef MessageIterator<M> iterator;
  typedef const MessageIterator<M> const_iterator;

  explicit MessageIterator(M const* data) : _data(data), _size(1) {}

  iterator begin() { return MessageIterator(_data); }
  const_iterator begin() const { return MessageIterator(_data); }
  iterator end() {
    auto it = MessageIterator(_data);
    it._current = it._size;
    return it;
  }
  const_iterator end() const {
    auto it = MessageIterator(_data);
    it._current = it._size;
    return it;
  }
  const M* operator*() const { return _data; }

  // prefix ++
  MessageIterator& operator++() {
    _current++;
    return *this;
  }

  // postfix ++
  MessageIterator operator++(int) {
    MessageIterator result(*this);
    ++(*this);
    return result;
  }

  bool operator!=(MessageIterator const& other) const {
    return _current != other._current;
  }

  size_t size() const { return _size; }

 private:
  M const* _data;
  size_t _current = 0;
  size_t _size = 1;
};

template <typename M>
struct MessageFormat;
template <typename M>
struct MessageCombiner;
/* In the longer run, maybe write optimized implementations for certain use
 cases. For example threaded
 processing */
template <typename M>
class IncomingCache {;

 public:
    IncomingCache(std::unique_ptr<MessageFormat<M>> const& format,
                std::unique_ptr<MessageCombiner<M>> const& combiner)
      : _format(format.get()), _combiner(combiner.get()) {}
  ~IncomingCache();

  void parseMessages(VPackSlice messages);
  /// @brief get messages for vertex id. (Don't use keys from _from or _to
  /// directly, they contain the collection name)
  MessageIterator<M> getMessages(std::string const& vertexId);
  void clear();

  /// @brief internal method to direclty set the messages for a vertex. Only
  /// valid with already combined messages
  void setDirect(std::string const& vertexId, M const& data);

 private:
  std::unordered_map<std::string, M> _messages;
  Mutex writeMutex;

  MessageFormat<M>* _format;
  MessageCombiner<M>* _combiner;
};
}
}
#endif
