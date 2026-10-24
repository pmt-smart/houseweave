# crypto.be -- the parts of Tasmota's crypto module (be_crypto_lib.c, mbedTLS)
# the panel uses: SHA-256 for the pattern's hash, and random bytes for its salt.
# The digest is the page's (a plain SHA-256); the interface is Tasmota's.
var crypto = module("crypto")

class SHA256
    var _data
    def init() self._data = bytes() end
    def update(b)
        self._data += b
        return self
    end
    def out() return bytes(_host("sha256", self._data.tohex())) end
end

crypto.SHA256 = SHA256
crypto.random = def (n) return bytes(_host("random", str(n))) end
return crypto
