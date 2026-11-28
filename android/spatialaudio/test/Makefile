# Builds the engine sources used by the Android library with the host
# compiler and runs the verification suite. `make run` (or `make run FAST=1`
# to use the Android release flags -O3 -ffast-math).
CXX ?= clang++
ENGINE := ../src/main/cpp/engine
OPT := $(if $(FAST),-O3 -ffast-math,-O2)
CXXFLAGS := -std=c++17 $(OPT) -Wall -Wextra -Wpedantic -Wshadow -fno-exceptions -fno-rtti -I$(ENGINE)
SOURCES := engine_test.cpp $(wildcard $(ENGINE)/*.cpp)

engine_test: $(SOURCES) $(wildcard $(ENGINE)/*.h) Makefile
	$(CXX) $(CXXFLAGS) -o $@ $(SOURCES)

run: engine_test
	./engine_test out

# Host CPU profile per stage.
bench_host: bench.cpp $(wildcard $(ENGINE)/*.cpp) $(wildcard $(ENGINE)/*.h) Makefile
	$(CXX) $(CXXFLAGS) -o $@ bench.cpp $(wildcard $(ENGINE)/*.cpp)

bench: bench_host
	./bench_host

# Same profile on a phone over adb: arm64 with the flags Gradle really uses
# (CMake's RelWithDebInfo -O2 lands after the module's -O3). Runs pinned to
# a LITTLE and a big core; pick them with LITTLE_CPU / BIG_CPU (hex masks).
ANDROID_HOME ?= $(HOME)/Library/Android/sdk
NDK_CXX := $(ANDROID_HOME)/ndk/28.0.13004108/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang++
ADB := $(ANDROID_HOME)/platform-tools/adb $(if $(SERIAL),-s $(SERIAL))
LITTLE_CPU ?= 1
BIG_CPU ?= 80
DEVICE_FLAGS := --target=aarch64-linux-android24 -std=c++17 -O3 -ffast-math -fno-exceptions -fno-rtti -O2 -DNDEBUG \
  -static-libstdc++ -Wall -Wextra -I$(ENGINE)

bench_arm64: bench.cpp $(wildcard $(ENGINE)/*.cpp) $(wildcard $(ENGINE)/*.h) Makefile
	$(NDK_CXX) $(DEVICE_FLAGS) -o $@ bench.cpp $(wildcard $(ENGINE)/*.cpp)

device-bench: bench_arm64
	$(ADB) push bench_arm64 /data/local/tmp/sa_bench >/dev/null
	@echo "== LITTLE core (mask $(LITTLE_CPU))"
	$(ADB) shell taskset $(LITTLE_CPU) /data/local/tmp/sa_bench
	@echo "== big core (mask $(BIG_CPU))"
	$(ADB) shell taskset $(BIG_CPU) /data/local/tmp/sa_bench

clean:
	rm -f engine_test bench_host bench_arm64

.PHONY: run bench device-bench clean
