cmake_minimum_required(VERSION 3.22.1)
project(spatialaudio CXX)
# The engine sources (engine/*.cpp) build both here and on the desktop for tests.
file(GLOB ENGINE_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/engine/*.cpp)
add_library(spatialaudio SHARED jni.cpp ${ENGINE_SOURCES})
target_include_directories(spatialaudio PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/engine)
target_link_libraries(spatialaudio log)
# Target options come after CMAKE_CXX_FLAGS_RELWITHDEBINFO (-O2), so -O3 really applies.
target_compile_options(spatialaudio PRIVATE -O3 -ffast-math)
# 16 KB page alignment (Android 15+ devices).
target_link_options(spatialaudio PRIVATE "-Wl,-z,max-page-size=16384")
