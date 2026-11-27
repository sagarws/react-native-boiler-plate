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

clean:
	rm -f engine_test

.PHONY: run clean
