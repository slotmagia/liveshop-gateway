package server

import (
	"encoding/json"
	"net/http"
)

// write emits the Gateway error envelope. Upstream envelopes pass through the
// proxy untouched; this is only for decisions Gateway makes itself.
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
