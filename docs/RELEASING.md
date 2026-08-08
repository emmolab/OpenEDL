# Release and container publishing

Ordinary pushes and pull requests run the **Validate** workflow. They install
dependencies, lint the project, build it, and run the test suite, but they do
not build or publish a GHCR package version.

Container images are published only by the **Publish container image**
workflow in one of these cases:

1. A GitHub Release is published.
2. An administrator starts the workflow manually and supplies an existing Git
   release tag.

## Publish a normal release

Create a release tag such as `v1.4.0`, then publish a GitHub Release for that
tag. The workflow checks out the tagged commit, builds and smoke-tests the
container, and publishes the multi-platform image.

A stable `v1.4.0` release receives these tags:

```text
v1.4.0
1.4.0
1.4
1
latest
```

The exact release tag remains attached to its image permanently. A later
stable release moves `latest` and the broad version aliases while retaining
the earlier release image.

Prereleases such as `v1.5.0-rc.1` receive only their exact version tags. They
do not move `latest`, `1`, or `1.5`.

## Manual publishing

Use **Actions → Publish container image → Run workflow** when an image needs to
be rebuilt for an existing Git tag without creating another GitHub Release.
Enter the tag and choose whether that image should also become `latest`.

The workflow rejects branch names and arbitrary commits: the supplied value
must look like a release version and must be an existing tag on the checked-out
commit.

## Package retention

There is no automated package-deletion workflow. Since images are created only
for releases, release images and their attestations remain available for
rollback. Remove a release image from GHCR manually only when its retention is
an intentional administrative decision.
